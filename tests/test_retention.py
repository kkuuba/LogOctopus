import os, time, zipfile, tempfile, shutil, threading
from backend.utils import retention as r

d = tempfile.mkdtemp()
dev = os.path.join(d, "dev1"); os.makedirs(dev); os.makedirs(os.path.join(d, "dissectors"))
open(os.path.join(d, "dissectors", "x.lua"), "w").write("x")
def mk(name, size, age_days):
    p = os.path.join(dev, name)
    with open(p, "wb") as f: f.write(os.urandom(1000) + b"A" * size)
    t = time.time() - age_days * 86400
    os.utime(p, (t, t)); return p

new   = mk("aaa_1.parquet", 5000, 0.2)
mid   = mk("bbb_1.parquet", 5000, 10)
old   = mk("ccc_1.parquet", 5000, 40)
pcap  = mk("sess1.pcap", 3_000_000, 10)
other = os.path.join(dev, "foreign.tmp"); open(other, "w").write("keep me")
t = time.time() - 5*86400*10; os.utime(other, (t, t))

pol = r.RetentionPolicy(True, 7, 30, True)
assert pol.validate() is None
assert r.RetentionPolicy(True, 30, 7).validate()
forgotten = []

# dry run changes nothing
rep = r.run_sweep(d, pol, dry_run=True)
assert rep["compress"]["count"] == 2 and rep["delete"]["count"] == 1, rep
assert os.path.exists(mid) and os.path.exists(old)

rep = r.run_sweep(d, pol, forget_snapshot=forgotten.append)
print({k: rep[k] for k in ("compress", "delete", "release", "errors")})
assert rep["compress"]["count"] == 2 and rep["delete"]["count"] == 1 and not rep["errors"]
assert forgotten == [old]
assert os.path.exists(new) and not os.path.exists(mid) and r.is_archived(mid) and r.is_archived(pcap)
assert not os.path.exists(old) and not os.path.exists(old + ".zip")
assert os.path.exists(other), "foreign .tmp must be untouched"
# age preserved on the zip
assert abs((time.time() - os.path.getmtime(mid + ".zip")) / 86400 - 10) < 0.01

# idempotent
rep = r.run_sweep(d, pol); assert rep["compress"]["count"] == 0 and rep["delete"]["count"] == 0

# restore with progress
seen = []
assert r.restore_file(pcap, seen.append) is True
assert sum(seen) == 3_001_000 and os.path.exists(pcap) and os.path.exists(pcap + ".zip")
assert r.restore_file(pcap) is False

# restored copy must NOT be re-zipped / deleted by the next sweep
rep = r.run_sweep(d, pol)
assert rep["compress"]["count"] == 0 and rep["release"]["count"] == 0 and os.path.exists(pcap)
# ...but is released after TTL of no access; zip keeps original age
rep = r.run_sweep(d, pol, now=time.time() + r.RESTORED_TTL_S + 5)
assert rep["release"]["count"] == 1 and not os.path.exists(pcap) and r.is_archived(pcap)

# async job with progress
job = r.start_restore_job([("x", mid), ("p", pcap), ("dup", mid)])
assert job["files_total"] == 2 and job["total_bytes"] > 3_000_000
last = None
while True:
    j = r.get_restore_job(job["id"])
    if j["status"] != "running": break
    time.sleep(0.01)
assert j["status"] == "done" and j["done_bytes"] == j["total_bytes"] and j["files_done"] == 2, j
assert r.start_restore_job([("x", mid)])["status"] == "done"      # nothing left to do

# job error surface
os.remove(mid + ".zip"); os.remove(mid)
r.start_restore_job([("gone", mid)])  # nothing to do, not archived -> done
# streaming from zip
size, it = r.iter_archived(pcap)
assert size == 3_001_000 and sum(len(c) for c in it) == size

# expiry of archived zip
rep = r.run_sweep(d, pol, now=time.time() + 31 * 86400)
assert os.path.exists(os.path.join(dev, "sess1.pcap.zip")) is False, "pcap zip should expire"
# stale own temp cleanup only
stale = os.path.join(dev, "z.parquet.zip.deadbeef.tmp"); open(stale, "w").write("x")
t = time.time() - 3*86400; os.utime(stale, (t, t))
r.run_sweep(d, pol); assert not os.path.exists(stale) and os.path.exists(other)

# disabled-compress / never-delete variants
mk("ddd_1.parquet", 100, 400)
rep = r.run_sweep(d, r.RetentionPolicy(True, 0, 0, True)); assert rep["compress"]["count"] == 0 and rep["delete"]["count"] == 0
# pcap exclusion
mk("sess2.pcap", 100, 400)
rep = r.run_sweep(d, r.RetentionPolicy(True, 7, 0, False), dry_run=True); assert rep["compress"]["count"] == 1  # only ddd parquet

# scheduler
sch = r.RetentionScheduler(d, lambda: pol, forgotten.append)
assert sch.sweep(pol) is not None and sch.status()["last_run"]
print(r.storage_stats(d))
shutil.rmtree(d); print("ALL OK")