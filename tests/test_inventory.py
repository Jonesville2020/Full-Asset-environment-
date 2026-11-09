import tempfile
import unittest
from pathlib import Path

import app


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "inventory.db")
        app.initialize(self.path)
        self.db = app.connect(self.path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_assigned_asset_follows_person_and_availability_is_checked(self):
        app.save(self.db, "locations", {"name": "A", "x": 0, "y": 0, "width": 20, "height": 20})
        app.save(self.db, "locations", {"name": "B", "x": 20, "y": 0, "width": 20, "height": 20})
        app.save(self.db, "people", {"name": "Alex", "location_id": 1})
        app.save(self.db, "assets", {"tag": "T1", "name": "Laptop", "status": "in use", "person_id": 1})
        self.assertEqual(app.state(self.db)["assets"][0]["location"], "A")
        app.save(self.db, "people", {"id": 1, "name": "Alex", "location_id": 2})
        self.assertEqual(app.state(self.db)["assets"][0]["location"], "B")
        with self.assertRaises(ValueError):
            app.save(self.db, "assets", {"tag": "T2", "name": "Dock", "status": "available", "person_id": 1})

    def test_location_geometry_and_foreign_keys(self):
        with self.assertRaises(ValueError):
            app.save(self.db, "locations", {"name": "Outside", "x": 90, "y": 0, "width": 20, "height": 10})
        app.save(self.db, "locations", {"name": "A", "x": 0, "y": 0, "width": 10, "height": 10})
        app.save(self.db, "people", {"name": "Alex", "location_id": 1})
        with self.assertRaises(app.sqlite3.IntegrityError):
            self.db.execute("DELETE FROM locations WHERE id=1")

    def test_compare_and_import_do_not_overwrite_existing_assets(self):
        app.save(self.db, "locations", {"name": "A", "x": 0, "y": 0, "width": 10, "height": 10})
        app.save(self.db, "people", {"name": "Alex", "location_id": 1})
        app.save(self.db, "assets", {"tag": "T1", "name": "Laptop", "status": "in use", "person_id": 1})
        payload = {
            "csv": 'Tag,Description,Person,Space\nT1,"Old, description",Alex,A\nT2,Monitor,,A\nT3,Phone,Unknown,A\nT4,Duplicate,,A\nt4,Duplicate,,A\n',
            "mapping": {"tag": "Tag", "description": "Description", "person": "Person", "location": "Space"},
        }
        compared = app.compare_wasp(self.db, payload)
        self.assertEqual([r["result"] for r in compared["results"]],
                         ["Different", "Only in WASP", "Only in WASP", "Missing or duplicate tag", "Missing or duplicate tag"])
        self.assertEqual(compared["results"][0]["differences"][0]["wasp"], "Old, description")
        self.assertEqual(len(app.state(self.db)["assets"]), 1)
        imported = app.compare_wasp(self.db, payload, True)
        self.assertEqual(imported["imported"], 1)
        assets = app.state(self.db)["assets"]
        self.assertEqual([(a["tag"], a["name"], a["status"]) for a in assets],
                         [("T1", "Laptop", "in use"), ("T2", "T2", "unverified")])
        self.assertEqual(app.compare_wasp(self.db, payload, True)["imported"], 0)

    def test_import_rejects_conflicting_person_location(self):
        app.save(self.db, "locations", {"name": "A", "x": 0, "y": 0, "width": 10, "height": 10})
        app.save(self.db, "locations", {"name": "B", "x": 10, "y": 0, "width": 10, "height": 10})
        app.save(self.db, "people", {"name": "Alex", "location_id": 1})
        result = app.compare_wasp(self.db, {"csv": "Tag,Person,Space\nT1,Alex,B\n",
                                            "mapping": {"tag": "Tag", "person": "Person", "location": "Space"}}, True)
        self.assertEqual(result["imported"], 0)
        self.assertIn("conflicting", result["results"][0]["result"])

    def test_only_local_and_missing_tag_are_reported(self):
        app.save(self.db, "assets", {"tag": "T1", "name": "Laptop", "status": "available"})
        result = app.compare_wasp(self.db, {"csv": "Tag,Name\n,No tag\n",
                                            "mapping": {"tag": "Tag", "name": "Name"}})
        self.assertEqual([row["result"] for row in result["results"]],
                         ["Missing or duplicate tag", "Only in local inventory"])


if __name__ == "__main__":
    unittest.main()
