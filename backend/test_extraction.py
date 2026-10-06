import unittest
from .extraction import candidates_for, select_laya_values


class FakeAgent:
    def __init__(self, choice="V0", confidence=0.9):
        self.choice, self.confidence = choice, confidence

    def predict(self, state, questions):
        self.state = state
        return {"answers": {key: {"choice": self.choice, "confidence": self.confidence} for key in questions}}


class ExtractionTests(unittest.TestCase):
    def test_label_candidates_and_evidence(self):
        field = {"column": "customer_name", "terms": "bill to,customer", "type": "text"}
        result = candidates_for("Bill to: Alice\nRate: 100", field)
        self.assertEqual(result[0].value, "Alice")
        self.assertIn("Bill to", result[0].evidence)

    def test_numbers_and_candidate_limit(self):
        field = {"column": "rate", "terms": "rate", "type": "number"}
        self.assertEqual(len(candidates_for("10 20 30 40", field, 2)), 2)

    def test_only_source_candidates_are_returned(self):
        result = select_laya_values(FakeAgent(), "Customer: Alice", [{"column": "customer_name", "terms": "customer"}], 0.65, 8)
        self.assertEqual(result["values"]["customer_name"], "Alice")
        self.assertEqual(result["confidence"]["customer_name"], 0.9)

    def test_abstains_on_low_confidence_unknown_choices_and_none(self):
        for agent in (FakeAgent(confidence=0.2), FakeAgent(choice="NONE"), FakeAgent(choice="invented")):
            result = select_laya_values(agent, "Customer: Alice", [{"column": "customer_name", "terms": "customer"}], 0.65, 8)
            self.assertEqual(result["values"]["customer_name"], "")
            self.assertTrue(result["warnings"])

    def test_missing_candidates_never_call_model(self):
        result = select_laya_values(None, "No relevant data", [{"column": "customer_name", "terms": "customer"}], 0.65, 8)
        self.assertEqual(result["values"]["customer_name"], "")


if __name__ == "__main__":
    unittest.main()
