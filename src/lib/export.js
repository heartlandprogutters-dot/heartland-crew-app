import JSZip from "jszip";
import { assertPublicShape } from "./feed.js";

export async function buildJobsZip(jobs, files, { type = "blob" } = {}) {
  for (const job of jobs) assertPublicShape(job);
  const zip = new JSZip();
  zip.file("jobs.txt", `${JSON.stringify(jobs, null, 2)}\n`);
  for (const file of files) {
    const folder = zip.folder(file.folder || "photos");
    folder.file(file.name, file.bytes);
  }
  return zip.generateAsync({ type });
}
