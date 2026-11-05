"""Offline fake Hub responses; no token or HTTP request to the real service."""
import io
import json
import unittest
from urllib.error import HTTPError, URLError

from check_hf_space import check_runtime_payload, check_space


class Response:
    def __init__(self, payload, status=200):
        self.data=json.dumps(payload).encode("utf-8")
        self.status=status
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self,n): return self.data[:n]


class PreflightTests(unittest.TestCase):
    def test_confirmed_free_running(self):
        self.assertTrue(check_runtime_payload({
            "stage":"RUNNING",
            "hardware":"zero-a10g",
            "requested_hardware":"zero-a10g",
        }).ready)

    def test_protects_queue_on_other_runtime_states(self):
        for stage in ["BUILDING", "APP_STARTING", "BUILD_ERROR", "STOPPED", "SLEEPING", None]:
            with self.subTest(stage=stage):
                self.assertFalse(check_runtime_payload({
                    "stage": stage, "hardware": "zero-a10g",
                    "requested_hardware": "zero-a10g",
                }).ready)

    def test_refuses_paid_and_cpu_hardware(self):
        for hw in ["cpu-basic","t4-small","a10g-small","a100-large",None]:
            with self.subTest(hardware=hw):
                self.assertFalse(check_runtime_payload({
                    "stage":"RUNNING", "hardware":hw, "requested_hardware":"zero-a10g"
                }).ready)

    def test_refuses_requested_paid_hardware(self):
        self.assertFalse(check_runtime_payload({
            "stage":"RUNNING","hardware":"zero-a10g","requested_hardware":"t4-small"
        }).ready)

    def test_missing_token_never_fetches(self):
        def unexpected(*args,**kwargs):
            self.fail("Network call with missing token")
        self.assertFalse(check_space("jokas1/dropec-flux2-pilot","",opener=unexpected).ready)

    def test_nonexisting_space_http_404_preserves_queue(self):
        def fake(req,timeout):
            raise HTTPError(req.full_url,404,"not found",{},io.BytesIO())
        result=check_space("jokas1/dropec-flux2-pilot","test-token",opener=fake)
        self.assertFalse(result.ready)
        self.assertIn("not created",result.reason)

    def test_eligibility_402_preserves_queue(self):
        def fake(req,timeout):
            raise HTTPError(req.full_url,402,"Payment Required",{},io.BytesIO())
        result=check_space("jokas1/dropec-flux2-pilot","test-token",opener=fake)
        self.assertFalse(result.ready)
        self.assertIn("402",result.reason)

    def test_network_failure_preserves_queue(self):
        def fake(req,timeout): raise URLError("offline")
        self.assertFalse(check_space("jokas1/dropec-flux2-pilot","test-token",opener=fake).ready)

    def test_actual_fetch_uses_no_paid_api(self):
        seen={}
        def fake(req,timeout):
            seen["url"]=req.full_url
            seen["auth"]=req.get_header("Authorization")
            return Response({"stage":"RUNNING","hardware":"zero-a10g"})
        result=check_space("jokas1/dropec-flux2-pilot","test-token",opener=fake)
        self.assertTrue(result.ready)
        self.assertEqual(seen["url"],
            "https://huggingface.co/api/spaces/jokas1/dropec-flux2-pilot/runtime")
        self.assertEqual(seen["auth"],"Bearer test-token")

    def test_invalid_payload(self):
        self.assertFalse(check_runtime_payload({"error":"not available"}).ready)


if __name__ == "__main__":
    unittest.main()
