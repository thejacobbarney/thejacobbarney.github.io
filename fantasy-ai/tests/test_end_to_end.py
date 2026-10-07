"""Runs the real CLI against a scratch copy of the project with a synthetic snapshot."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
import fixtures  # noqa: E402


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for d in ("config", "personas", "agents"):
            shutil.copytree(ROOT / d, self.tmp / d)
        (self.tmp / "data").mkdir()
        (self.tmp / "out").mkdir()
        (self.tmp / "data" / "snapshot.json").write_text(json.dumps(fixtures.snapshot()))
        self.env = {**os.environ, "FANTASY_AI_ROOT": str(self.tmp), "PYTHONPATH": str(ROOT / "src")}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def cli(self, *args):
        r = subprocess.run([sys.executable, "-m", "fantasy_ai", *args], env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout

    def test_full_week(self):
        self.cli("new-agent", "2", "quant")
        self.cli("new-agent", "3", "trade_shark")
        self.assertTrue((self.tmp / "agents/team02-quant/persona.md").exists())
        self.assertIn("team02-quant", (self.tmp / "config/league.yaml").read_text())
        self.assertIn("my_team_id", (self.tmp / "config/league.yaml").read_text())

        out = self.cli("prepare", "wednesday")
        bundle = (self.tmp / "out/week-05/team02-quant/wednesday.md").read_text()
        self.assertIn("The Quant", bundle)
        self.assertIn("config/rules.yaml", bundle)
        self.assertNotIn("The Trade Shark", bundle)  # agents are isolated from each other's personas

        moves = {"team_id": 2, "week": 5, "phase": "wednesday", "moves": [
            {"type": "waiver_claim", "add": {"id": 900, "name": "Waiver Guy"}, "drop": {"id": 206, "name": "P206"},
             "faab_bid": 5, "reason": "Best projected WR on the wire, replaces the WR4."},
            {"type": "waiver_claim", "add": {"id": 901, "name": "Streamer QB"}, "faab_bid": 50, "reason": "Overbid on purpose."}]}
        (self.tmp / "out/week-05/moves/team02-quant.wednesday.json").write_text(json.dumps(moves))
        out = self.cli("collect")
        self.assertIn("1 approved, 1 rejected", out)
        sheet = (self.tmp / "out/week-05/move_sheet.md").read_text()
        self.assertIn("add Waiver Guy, drop P206, bid $5", sheet)
        log = (self.tmp / "agents/team02-quant/decision_log.jsonl").read_text().splitlines()
        self.assertEqual(len(log), 2)

        self.cli("collect")  # idempotent
        self.assertEqual(len((self.tmp / "agents/team02-quant/decision_log.jsonl").read_text().splitlines()), 2)
        self.cli("summary")
        self.assertIn("waiver_claim", (self.tmp / "out/week-05/weekly_summary.md").read_text())


if __name__ == "__main__":
    unittest.main()
