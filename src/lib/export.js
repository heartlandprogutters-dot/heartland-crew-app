import JSZip from "jszip";
import { assertPublicShape } from "./feed.js";

export async function buildJobsZip(jobs, files, { type = "blob" } = {}) {
  for (const job of jobs) assertPublicShape(job);
  const zip = new JSZip();
  zip.file("jobs.txt", `${JSON.stringify(jobs, null, 2)}\n`);
  const folder = zip.folder("photos");
  for (const file of files) folder.file(file.name, file.bytes);
  return zip.generateAsync({ type });
}
