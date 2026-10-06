"""Explicitly prepare default Laya weights for an offline distribution."""
from .server import ModelSpec, download_job, jobs


def main():
    spec = ModelSpec()
    job_id = "prepare-default"
    jobs[job_id] = {"id": job_id, "status": "queued", "repo_id": spec.repo_id, "message": "Preparing…"}
    print(f"Downloading {spec.repo_id}@{spec.revision}. No document data is sent.")
    download_job(job_id, spec)
    print(jobs[job_id]["message"])
    if jobs[job_id]["status"] != "complete":
        raise SystemExit(1)
    print("Package the .models directory with your installation, retaining the model license.")


if __name__ == "__main__":
    main()
