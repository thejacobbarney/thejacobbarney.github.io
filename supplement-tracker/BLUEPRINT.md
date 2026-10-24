# Supplement Tracker — Design Blueprint

A relational schema and calculation logic for tracking a daily supplement regimen: recurring schedules, dosing, inventory/reorder alerts, active-ingredient synergy, and interactions.

Companion file: [`schema.sql`](./schema.sql) — runnable SQLite/Postgres DDL for the tables below.

## 1. Why relational, not flat

A single flat "supplements list" breaks on two real requirements: **synergy tracking** ("how much elemental Magnesium am I getting across three different products?") and **flexible recurrence** (daily vs. every-3-days vs. Mon/Wed/Fri vs. PRN all need different math). Both need the ingredient and the schedule broken out of the item into their own tables, linked by junctions. Eight tables cover it:

```
goals ──┐
        ├─< item_goals >──┐
items ──┘                 │
  │                        (n:n)
  ├─< item_ingredients >── ingredients ─┐ (self-referencing:
  │                                     │  compound → parent elemental nutrient)
  ├─< schedules ─< dose_logs            │
  │                                     │
  └─< inventory              interactions (ingredient_a ↔ ingredient_b)
```

## 2. Table layout

### `items` — master catalog

| Column | Type | Example |
|---|---|---|
| item_id (PK) | INTEGER | 1 |
| name | TEXT | "Magnesium Glycinate" |
| brand | TEXT | "Thorne" |
| form | ENUM | Capsule |
| container_size | NUMERIC | 120 |
| container_unit | TEXT | capsules |
| serving_size | NUMERIC | 2 |
| notes | TEXT | "Take at bedtime; may cause drowsiness" |
| is_active | BOOLEAN | true |
| date_added | DATE | 2026-01-15 |

### `goals` + `item_goals` — purpose

| goal_id | goal_name |
|---|---|
| 1 | Sleep Support |
| 2 | Joint Health |
| 3 | Energy |
| 4 | Recovery |

`item_goals`: (item_id=1, goal_id=1) → Magnesium Glycinate serves "Sleep Support".

### `ingredients` — active compound master list (enables synergy math)

| ingredient_id (PK) | ingredient_name | parent_nutrient_id | elemental_factor | default_unit |
|---|---|---|---|---|
| 10 | Zinc (elemental) | NULL | 1.00 | mg |
| 11 | Zinc Picolinate | 10 | 0.21 | mg |
| 12 | Zinc Citrate | 10 | 0.31 | mg |
| 20 | Magnesium (elemental) | NULL | 1.00 | mg |
| 21 | Magnesium Glycinate | 20 | 0.14 | mg |

`elemental_factor` is the fraction of the compound's weight that is the actual nutrient — this is what lets the tool convert "200 mg Zinc Picolinate" into "42 mg elemental Zinc" and roll it up against every other zinc-containing product.

### `item_ingredients` — junction: what's actually in each product, per serving

| item_ingredient_id | item_id | ingredient_id | amount_per_serving | unit | is_elemental_amount |
|---|---|---|---|---|---|
| 100 | 1 (Mg Glycinate) | 21 (Mg Glycinate) | 400 | mg | false |
| 101 | 2 (ZMA blend) | 11 (Zinc Picolinate) | 150 | mg | false |
| 102 | 2 (ZMA blend) | 21 (Mg Glycinate) | 450 | mg | false |

### `schedules` — recurrence + timing per item

| schedule_id | item_id | dose_servings | frequency_type | interval_days | days_of_week | timing | meal_requirement | min_hours_between | start_date |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 (Mg Glycinate) | 1 | Daily | NULL | NULL | Bedtime | With Food | NULL | 2026-01-15 |
| 2 | 3 (Vitamin D3) | 1 | Every_X_Days | 3 | NULL | Morning | With Fat | NULL | 2026-02-01 |
| 3 | 4 (Fish Oil) | 2 | Specific_Days | NULL | Mon,Wed,Fri | Morning | With Food | NULL | 2026-03-01 |
| 4 | 5 (Ibuprofen) | 1 | As_Needed | NULL | NULL | NULL | With Food | 6 | 2026-01-01 |

### `dose_logs` — actual intake history (drives "next due" + inventory decrement)

| log_id | schedule_id | item_id | taken_at | amount_taken | status |
|---|---|---|---|---|---|
| 500 | 1 | 1 | 2026-08-03 22:10 | 1 | Taken |
| 501 | 2 | 3 | 2026-08-02 08:05 | 1 | Taken |
| 502 | 4 | 5 | 2026-08-04 09:00 | 1 | Taken |

### `inventory` — stock + reorder

| inventory_id | item_id | units_remaining | units_purchased | purchase_date | reorder_threshold_days |
|---|---|---|---|---|---|
| 900 | 1 (Mg Glycinate) | 46 capsules | 120 | 2026-06-01 | 14 |
| 901 | 3 (Vitamin D3) | 18 capsules | 90 | 2026-05-01 | 14 |

### `interactions` — pairwise rules (optional, powers the "don't take with Calcium" note as structured data instead of free text)

| interaction_id | ingredient_a_id | ingredient_b_id | interaction_type | min_hours_apart |
|---|---|---|---|---|
| 1 | 10 (Zinc) | 30 (Calcium) | Space Apart | 2 |
| 2 | 40 (Iron) | 30 (Calcium) | Competes For Absorption | 2 |

## 3. Calculation logic

### Next Dose Date

Anchor is always the most recent `dose_logs.taken_at` for that schedule (fall back to `schedules.start_date` if no log exists yet). Recommended default: **rolling anchoring** — the interval counts from when you *actually* took the last dose, not the originally scheduled date. (Fixed-calendar anchoring is a valid alternate mode — see note below — but drifts out of sync with real depletion when a dose is taken early or late.)

**Daily**
```
next_due_date = DATE(last_taken_at) + 1 day
```

**Every X Days** (the "every 2 / every 3 days" case)
```
next_due_date = DATE(last_taken_at) + interval_days
```
Example: last dose Aug 1, `interval_days = 3` → next due **Aug 4**.

*Fixed-calendar alternative* (anchors to a schedule origin instead of last actual dose — use if you want doses to always land on the same weekday cadence regardless of lateness):
```
n = CEILING((TODAY - start_date) / interval_days)
next_due_date = start_date + (n * interval_days)
```

**Specific Days of Week**
```
cursor = last_taken_at ? DATE(last_taken_at) + 1 day : TODAY
while WEEKDAY(cursor) not in days_of_week:
    cursor = cursor + 1 day
next_due_date = cursor
```

**As Needed / PRN**
No auto-generated due date. Instead compute a safety gate:
```
earliest_next_allowed = last_taken_at + min_hours_between
is_available = NOW() >= earliest_next_allowed
```
Display "Available again at `earliest_next_allowed`" until that time passes.

**Time-of-day + overdue flag**
`timing` maps to a default clock time (user-configurable): Morning 08:00, Afternoon 13:00, Evening 18:00, Bedtime 22:00.
```
next_due_datetime = next_due_date + timing_clock_time
is_overdue = NOW() > next_due_datetime AND no dose_log exists for next_due_date
```

### Inventory Run-out Date

Convert every frequency type to a **daily consumption rate** (in servings/day), then divide remaining stock by it:

| frequency_type | daily_consumption_rate |
|---|---|
| Daily | `dose_servings` |
| Every_X_Days | `dose_servings / interval_days` |
| Specific_Days | `dose_servings * (COUNT(days_of_week) / 7)` |
| As_Needed | trailing average: `SUM(amount_taken, last 30 days) / 30` |

```
days_of_supply_left = units_remaining / (daily_consumption_rate * serving_size)
estimated_runout_date = TODAY + FLOOR(days_of_supply_left)
reorder_alert = days_of_supply_left <= reorder_threshold_days
```
`units_remaining` should decrement automatically on every `dose_logs` insert with `status = 'Taken'` (`units_remaining -= amount_taken * serving_size`).

### Synergy / Double-Dose Check

For a given elemental nutrient (a row in `ingredients` with `parent_nutrient_id IS NULL`, e.g. "Zinc"), sum the **daily elemental equivalent** across every active schedule that touches it:

```
total_daily_elemental(nutrient) =
    SUM over all active schedules S, joined item_ingredients II on S.item_id
    where II.ingredient_id = nutrient OR II.ingredient_id.parent_nutrient_id = nutrient:

        elemental_amount = II.is_elemental_amount
            ? II.amount_per_serving
            : II.amount_per_serving * ingredient.elemental_factor

        elemental_amount * S.dose_servings * daily_consumption_rate_factor(S)
```
where `daily_consumption_rate_factor` is the same per-frequency-type factor used in the run-out calc above (1 for Daily, `1/interval_days` for Every_X_Days, `count(days)/7` for Specific_Days).

Compare the result against a per-nutrient upper-limit reference table (optional future addition) and flag when exceeded — this is what catches "you're getting 60mg of elemental zinc/day from three different products, above the 40mg UL."

## 4. Implementation recommendations

| Platform | Fit for this schema | Pros | Cons |
|---|---|---|---|
| **Airtable** (recommended) | Strong | Native linked-record fields handle the `item_ingredients` and `item_goals` junctions directly; rollup + formula fields can compute elemental totals and run-out dates without code; Automations can send a push/email/Slack alert when `reorder_alert` flips true or a dose goes overdue; mobile app makes daily logging fast. | Formula language is less expressive than SQL for the weekday-cursor logic (Specific Days) — doable but fiddly; free tier caps records/automations. |
| **Notion** | Moderate | Relations + rollups model the same junctions; nice for combining the tracker with notes/journaling you may already keep in Notion; database views (calendar, board) are good for a "what's due today" view. | Formula engine is weaker than Airtable's for multi-hop rollups (e.g., elemental synergy sums spanning `item_ingredients` → `ingredients` parent lookup); no native push notifications/automation without a third-party integration (e.g., Zapier/Make). |
| **Google Sheets / Excel** | Weak–Moderate | Free, fully transparent formulas (`WORKDAY`, `IF`, `SUMIFS` can implement the run-out and next-due math directly); easiest to audit/tweak by hand. | No real relational integrity — junction tables become manual VLOOKUP/INDEX-MATCH plumbing that breaks silently when rows are inserted/reordered; reminders require Apps Script; gets unwieldy past a few dozen items × ingredients. |
| **Custom code** (SQLite/Postgres + a small app, e.g. Retool/Glide over the schema, or a bespoke web app) | Best long-term, highest effort | Exactly this schema, full control over the recurrence/synergy logic as real code (testable, no formula-language ceiling), can push real notifications; fits naturally as a future addition to this site alongside `movie-spork/`. | Requires actually building the app; no built-in mobile notifications without extra plumbing (e.g., a PWA + web push, or a Telegram/Discord bot for reminders). |

**Suggested path:** prototype in **Airtable** using this exact table layout (it maps almost 1:1 onto Airtable bases) to validate the workflow with real data for a few weeks, then port to custom code only if you hit Airtable's formula/automation ceiling on the synergy calculations.
