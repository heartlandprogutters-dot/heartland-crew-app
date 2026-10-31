import exifr from "exifr";

export async function readPhotoExif(file) {
  try {
    const data = await exifr.parse(file, { gps: true });
    if (!data) return null;
    const lat = Number(data.latitude);
    const lng = Number(data.longitude);
    const taken = data.DateTimeOriginal || data.CreateDate || null;
    const takenAt = taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null;
    if (!Number.isFinite(lat) && !Number.isFinite(lng) && !takenAt) return null;
    return {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      takenAt,
    };
  } catch {
    return null;
  }
}
