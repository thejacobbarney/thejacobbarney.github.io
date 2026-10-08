import copy
import os
import sys
import unittest
import yaml
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from fantasy_ai import guardrails  # noqa: E402
import fixtures  # noqa: E402

RULES = yaml.safe_load((ROOT / "config" / "rules.yaml").read_text())
R = "a reason that is long enough"


def run(moves, team_id=2, rules=RULES, state=None, snap=None):
    doc = {"team_id": team_id, "week": 5, "phase": "wednesday", "moves": moves}
    return guardrails.validate(doc, snap or fixtures.snapshot(), rules, fixtures.CFG, state or guardrails.new_state())


def gap_snapshot(**changes):
    """Team 2's player 206 gets a missing week projection (plus any other field changes)."""
    snap = fixtures.snapshot()
    p = next(x for x in snap["teams"][1]["roster"] if x["id"] == 206)
    p.update({"week_projected": 0, **changes})
    return snap


def claim(add_avg=None, **extra):
    add = {"id": 900, "name": "Waiver Guy"}
    mv = {"type": "waiver_claim", "add": add, "drop": {"id": 206}, "faab_bid": 5, "reason": R, **extra}
    return mv


class GuardrailTests(unittest.TestCase):
    def test_good_claim_approved(self):
        ok, bad = run([{"type": "waiver_claim", "add": {"id": 900, "name": "W"}, "drop": {"id": 206},
                        "faab_bid": 5, "reason": R}])
        self.assertEqual((len(ok), len(bad)), (1, 0))

    def test_pause_rejects_everything(self):
        rules = copy.deepcopy(RULES); rules["paused"] = True
        ok, bad = run([{"type": "lineup", "changes": [], "reason": R}], rules=rules)
        self.assertEqual((len(ok), len(bad)), (0, 1))

    def test_short_reason_rejected(self):
        ok, bad = run([{"type": "waiver_claim", "add": {"id": 900}, "faab_bid": 1, "reason": "meh"}])
        self.assertEqual(len(ok), 0)
        self.assertIn("reason", bad[0]["violations"][0])

    def test_faab_weekly_cap(self):
        ok, bad = run([{"type": "waiver_claim", "add": {"id": 900}, "faab_bid": 21, "reason": R}])
        self.assertEqual(len(ok), 0)
        self.assertIn("cap", bad[0]["violations"][0])

    def test_cap_spans_multiple_claims(self):
        mv = lambda pid: {"type": "waiver_claim", "add": {"id": pid}, "faab_bid": 12, "reason": R}
        ok, bad = run([mv(900), mv(901)])
        self.assertEqual((len(ok), len(bad)), (1, 1))

    def test_cannot_claim_rostered_player(self):
        ok, bad = run([{"type": "waiver_claim", "add": {"id": 100}, "faab_bid": 1, "reason": R}])
        self.assertIn("already on a roster", bad[0]["violations"][0])

    def test_top_asset_drop_needs_reason(self):
        mv = {"type": "waiver_claim", "add": {"id": 900}, "drop": {"id": 200}, "faab_bid": 1, "reason": R}
        ok, bad = run([mv])
        self.assertEqual(len(ok), 0)
        mv["top_asset_drop_reason"] = "Season-ending injury confirmed, no path to value before the playoffs."
        ok, bad = run([mv])
        self.assertEqual(len(ok), 1)

    def test_cannot_drop_player_not_on_roster(self):
        ok, bad = run([{"type": "waiver_claim", "add": {"id": 900}, "drop": {"id": 100}, "faab_bid": 1, "reason": R}])
        self.assertIn("not on this team", bad[0]["violations"][0])

    def test_unmanaged_team_rejected(self):
        ok, bad = run([{"type": "lineup", "changes": [], "reason": R}], team_id=1)
        self.assertIn("not a managed", bad[0]["violations"][0])

    def test_trade_with_my_team_needs_outside_approval(self):
        ok, bad = run([{"type": "trade_proposal", "to_team_id": 1, "give": [{"id": 204}], "get": [{"id": 100}],
                        "reason": R}])
        self.assertEqual(len(ok), 1)
        self.assertTrue(ok[0]["requires_outside_approval"])
        self.assertEqual(ok[0]["execution"], "proposal_only")

    def test_bot_to_bot_weekly_cap(self):
        state = guardrails.new_state()
        t1 = {"type": "trade_proposal", "to_team_id": 3, "give": [{"id": 204}], "get": [{"id": 304}], "reason": R}
        ok1, _ = run([t1], team_id=2, state=state)
        t2 = {"type": "trade_proposal", "to_team_id": 4, "give": [{"id": 205}], "get": [{"id": 404}], "reason": R}
        ok2, bad2 = run([t2], team_id=2, state=state)
        self.assertEqual((len(ok1), len(ok2)), (1, 0))
        self.assertIn("bot-to-bot", bad2[0]["violations"][0])

    def test_trade_players_must_be_owned(self):
        ok, bad = run([{"type": "trade_proposal", "to_team_id": 1, "give": [{"id": 999}], "get": [{"id": 100}],
                        "reason": R}])
        self.assertEqual(len(ok), 0)


class DropGapTests(unittest.TestCase):
    """Dropping a player with a missing week projection: bye is not a problem, injury is, unexplained is blocked."""

    def snap_with_add(self, add_avg, **drop_changes):
        snap = gap_snapshot(**drop_changes)
        next(x for x in snap["free_agents"] if x["id"] == 900)["projected_avg_points"] = add_avg
        return snap

    def test_bye_with_per_game_edge_is_approved(self):
        snap = self.snap_with_add(12.0, bye_week=5, projected_avg_points=4.0)
        ok, bad = run([claim(gap_check={"cause": "bye", "evidence": "BYE wk5"})], snap=snap)
        self.assertEqual((len(ok), len(bad)), (1, 0))

    def test_bye_without_per_game_edge_is_rejected(self):
        # Higher this-week projection only because the dropped player is on bye.
        snap = self.snap_with_add(4.3, bye_week=5, projected_avg_points=4.0)
        ok, bad = run([claim(gap_check={"cause": "bye", "evidence": "BYE wk5"})], snap=snap)
        self.assertEqual(len(ok), 0)
        self.assertIn("bye", bad[0]["violations"][0])
        self.assertIn("schedule artifact", bad[0]["violations"][0])

    def test_injury_gap_is_allowed_when_verified(self):
        snap = self.snap_with_add(8.0, injury_status="OUT", projected_avg_points=4.0)
        ok, bad = run([claim(gap_check={"cause": "injury", "evidence": "OUT, hamstring, 4 weeks"})], snap=snap)
        self.assertEqual((len(ok), len(bad)), (1, 0))

    def test_bye_mislabelled_as_injury_is_rejected(self):
        snap = self.snap_with_add(12.0, bye_week=5, projected_avg_points=4.0)
        ok, bad = run([claim(gap_check={"cause": "injury", "evidence": "he looked hurt"})], snap=snap)
        self.assertEqual(len(ok), 0)
        self.assertIn("ESPN data says", bad[0]["violations"][0])

    def test_unexplained_gap_is_rejected_even_with_gap_check(self):
        snap = self.snap_with_add(12.0)
        ok, bad = run([claim(gap_check={"cause": "bye", "evidence": "trust me"})], snap=snap)
        self.assertEqual(len(ok), 0)
        self.assertIn("unexplained", bad[0]["violations"][0])

    def test_missing_gap_check_is_rejected(self):
        snap = self.snap_with_add(12.0, bye_week=5, projected_avg_points=4.0)
        ok, bad = run([claim()], snap=snap)
        self.assertIn("gap_check.cause is required", bad[0]["violations"][0])

    def test_player_out_on_bye_counts_as_injury(self):
        snap = self.snap_with_add(12.0, bye_week=5, injury_status="OUT", projected_avg_points=4.0)
        ok, bad = run([claim(gap_check={"cause": "injury", "evidence": "OUT"})], snap=snap)
        self.assertEqual(len(ok), 1)

    def test_normal_drop_needs_no_gap_check(self):
        ok, bad = run([claim()])
        self.assertEqual((len(ok), len(bad)), (1, 0))


if __name__ == "__main__":
    unittest.main()
