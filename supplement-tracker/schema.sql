-- Supplement Tracker — Relational Schema (SQLite/Postgres-compatible)
-- See BLUEPRINT.md in this folder for full design rationale and calculation logic.

-- ITEMS: master catalog of supplement products
CREATE TABLE items (
    item_id             INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    brand               TEXT,
    form                TEXT CHECK(form IN ('Capsule','Softgel','Powder','Liquid','Dropper','Sublingual','Gummy','Tablet','Topical','Injectable')),
    container_size      NUMERIC,      -- total units per bottle, e.g. 120 capsules / 60 mL
    container_unit      TEXT,         -- 'capsules', 'mL', 'g', 'servings'
    serving_size        NUMERIC,      -- units consumed per single serving, e.g. 2 capsules
    notes               TEXT,         -- free-text interaction/notes, e.g. "fat-soluble, take with meal"
    is_active           BOOLEAN DEFAULT 1,
    date_added          DATE DEFAULT CURRENT_DATE
);

-- GOALS: lookup of purposes ("why am I taking this")
CREATE TABLE goals (
    goal_id     INTEGER PRIMARY KEY,
    goal_name   TEXT UNIQUE NOT NULL   -- 'Sleep Support', 'Joint Health', 'Energy', 'Recovery', ...
);

-- ITEM_GOALS: many-to-many, an item can serve multiple purposes
CREATE TABLE item_goals (
    item_id INTEGER REFERENCES items(item_id),
    goal_id INTEGER REFERENCES goals(goal_id),
    PRIMARY KEY (item_id, goal_id)
);

-- INGREDIENTS: master nutrient/compound list, self-referencing for elemental parent
-- e.g. 'Zinc Picolinate' -> parent_nutrient_id -> 'Zinc (elemental)'
CREATE TABLE ingredients (
    ingredient_id       INTEGER PRIMARY KEY,
    ingredient_name     TEXT UNIQUE NOT NULL,
    parent_nutrient_id  INTEGER REFERENCES ingredients(ingredient_id),
    elemental_factor    NUMERIC DEFAULT 1.0,   -- fraction of compound weight that is elemental nutrient
    default_unit        TEXT                    -- 'mg', 'mcg', 'IU', 'g', 'billion CFU'
);

-- ITEM_INGREDIENTS: junction — amount of each active ingredient per serving of an item
CREATE TABLE item_ingredients (
    item_ingredient_id      INTEGER PRIMARY KEY,
    item_id                 INTEGER REFERENCES items(item_id),
    ingredient_id           INTEGER REFERENCES ingredients(ingredient_id),
    amount_per_serving      NUMERIC NOT NULL,
    unit                    TEXT NOT NULL,
    is_elemental_amount     BOOLEAN DEFAULT 0   -- true if amount is already expressed as elemental nutrient
);

-- SCHEDULES: dosing plan(s) per item (an item can have more than one, e.g. AM + PM doses)
CREATE TABLE schedules (
    schedule_id         INTEGER PRIMARY KEY,
    item_id             INTEGER REFERENCES items(item_id),
    dose_servings       NUMERIC NOT NULL,      -- number of servings per dose event
    frequency_type      TEXT CHECK(frequency_type IN ('Daily','Every_X_Days','Specific_Days','As_Needed')),
    interval_days       INTEGER,               -- used when frequency_type = 'Every_X_Days'
    days_of_week        TEXT,                  -- CSV, used when frequency_type = 'Specific_Days', e.g. 'Mon,Wed,Fri'
    timing              TEXT,                  -- 'Morning','Afternoon','Evening','Bedtime'
    meal_requirement    TEXT,                  -- 'With Food','Empty Stomach','Fasted','With Fat','None'
    min_hours_between   NUMERIC,               -- PRN safety spacing, e.g. 6 (hours)
    start_date          DATE DEFAULT CURRENT_DATE,
    end_date            DATE,
    is_active           BOOLEAN DEFAULT 1
);

-- DOSE_LOGS: actual intake history — source of truth for "last taken" and inventory decrement
CREATE TABLE dose_logs (
    log_id          INTEGER PRIMARY KEY,
    schedule_id     INTEGER REFERENCES schedules(schedule_id),
    item_id         INTEGER REFERENCES items(item_id),
    taken_at        DATETIME NOT NULL,
    amount_taken    NUMERIC,        -- servings actually taken (may differ from planned)
    status          TEXT CHECK(status IN ('Taken','Skipped','Missed')) DEFAULT 'Taken',
    notes           TEXT
);

-- INVENTORY: stock tracking per item (supports multiple open containers/lots)
CREATE TABLE inventory (
    inventory_id            INTEGER PRIMARY KEY,
    item_id                 INTEGER REFERENCES items(item_id),
    units_remaining         NUMERIC NOT NULL,   -- same unit as items.container_unit
    units_purchased         NUMERIC,
    purchase_date           DATE,
    cost                    NUMERIC,
    reorder_threshold_days  NUMERIC DEFAULT 14,
    last_updated            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- INTERACTIONS: pairwise ingredient interaction rules (optional advanced feature)
CREATE TABLE interactions (
    interaction_id      INTEGER PRIMARY KEY,
    ingredient_a_id      INTEGER REFERENCES ingredients(ingredient_id),
    ingredient_b_id      INTEGER REFERENCES ingredients(ingredient_id),
    interaction_type     TEXT CHECK(interaction_type IN ('Avoid Together','Space Apart','Enhances Absorption','Competes For Absorption')),
    min_hours_apart      NUMERIC,
    notes                TEXT
);
