# Strategy knobs per persona. The run loop reads these; persona.md holds the voice/narrative.
PERSONAS = {
 "quant":      {"title": "The Quant", "desc": "Projections only. Streams QB and D/ST weekly.",
                "stream": ["QB", "D/ST", "K"], "weight_proj": 1.0, "weight_avg": 0.0, "upside": 0.0, "trade_style": "value"},
 "stash_king": {"title": "The Stash King", "desc": "Hoards handcuffs and high-upside backups; plays for the playoffs.",
                "stream": ["D/ST", "K"], "weight_proj": 0.5, "weight_avg": 0.2, "upside": 0.6, "trade_style": "rarely"},
 "trade_shark":{"title": "The Trade Shark", "desc": "Constant 2-for-1 consolidation trades.",
                "stream": ["D/ST"], "weight_proj": 0.7, "weight_avg": 0.3, "upside": 0.1, "trade_style": "2for1"},
 "contrarian": {"title": "The Contrarian", "desc": "Buys slumping stars, sells hot streaks.",
                "stream": ["D/ST"], "weight_proj": 0.4, "weight_avg": 0.6, "upside": 0.2, "trade_style": "buy_low"},
 "balanced":   {"title": "Assistant", "desc": "Neutral helper for human managers: flags lineup problems and clear pickups.",
                "stream": [], "weight_proj": 0.7, "weight_avg": 0.3, "upside": 0.0, "trade_style": "none"},
 "safe_floor": {"title": "The Safe Floor", "desc": "Veteran-heavy, minimizes variance.",
                "stream": [], "weight_proj": 0.5, "weight_avg": 0.5, "upside": -0.3, "trade_style": "rarely"},
}
