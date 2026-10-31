import { el } from "../lib/dom.js";
import { destinationPoint } from "../lib/geo.js";
import { toPublicJob } from "../lib/feed.js";
import { todayISO } from "../lib/format.js";
import { renderShell } from "../ui/shell.js";
import { renderNewJob } from "./newjob.js";
import { renderPosts } from "./posts.js";
import { renderReview } from "./review.js";
import { renderCrew } from "./crew.js";

const exact = { lat: 36.6685, lng: -88.2167 };
const shifted = destinationPoint(exact.lat, exact.lng, 200, 0);
const samplePhoto = {
  id: "sample-photo",
  storage_path: "",
  public_url: null,
  previewUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#1f6b45"/><text x="40" y="240" fill="#f4f0e6" font-size="42" font-family="Georgia">Sample photo</text></svg>')}`,
  sort_order: 0,
};

const state = {
  role: "crew",
  people: [
    { id: "kent", display_name: "Kent", email: "kent@example.com", role: "admin", disabled: false },
    { id: "haley", display_name: "Haley", email: "haley@example.com", role: "approver", disabled: false },
    { id: "sam", display_name: "Sam", email: "sam@example.com", role: "crew", disabled: false },
  ],
  jobs: [
    {
      id: "sample-pending",
      status: "pending",
      service: "Seamless Gutters",
      town: "Farmington",
      state: "KY",
      title: "Seamless Gutters in Farmington, KY",
      summary: "New seamless gutters on a one-story house.",
      job_date: todayISO(),
      public_lat: null,
      public_lng: null,
      review_name: null,
      review_stars: null,
      review_text: null,
      review_date: null,
      gbp_url: null,
      rejection_reason: null,
      created_by: "sam",
      job_locations: { exact_lat: exact.lat, exact_lng: exact.lng, address: "Sample address for preview only" },
      job_photos: [{ ...samplePhoto }],
    },
    {
      id: "sample-approved",
      status: "approved",
      service: "Gutter Guards",
      town: "Murray",
      state: "KY",
      title: "Gutter Guards in Murray, KY",
      summary: "Guards added along the front and garage.",
      job_date: "2026-10-12",
      public_lat: shifted.lat,
      public_lng: shifted.lng,
      review_name: "Mike L.",
      review_stars: 5,
      review_text: "Clean work and on time.",
      review_date: "2026-10-13",
      gbp_url: null,
      rejection_reason: null,
      created_by: "sam",
      approved_at: "2026-10-12T18:00:00Z",
      job_locations: { exact_lat: exact.lat, exact_lng: exact.lng + 0.01, address: "Sample address for preview only" },
      job_photos: [{ ...samplePhoto, id: "sample-photo-2", public_url: samplePhoto.previewUrl }],
    },
  ],
};

function profile() {
  return state.people.find((person) => person.role === state.role) || state.people[2];
}

function poster(job) {
  return state.people.find((person) => person.id === job.created_by) || null;
}

export function renderPractice(route, rerender) {
  const me = profile();
  if (route.name === "review" && me.role === "crew") route = { ...route, name: "new", id: null };
  if (route.name === "crew" && me.role !== "admin") route = { ...route, name: "new", id: null };
  const hashFor = (id) => (id ? `#/preview/${id}` : `#/preview/${route.name || "new"}`);
  const reviewHash = (id) => (id ? `#/preview/review/${id}` : "#/preview/review");
  let content;
  if (route.name === "posts") {
    content = renderPosts({
      load: async () => state.jobs,
      remove: async (job) => {
        state.jobs = state.jobs.filter((item) => item.id !== job.id);
      },
      onCopy: () => { location.hash = "#/preview/new"; },
    });
  } else if (route.name === "review") {
    content = renderReview({
      load: async () => ({
        jobs: state.jobs.map((job) => ({ ...job, poster: poster(job) })),
        people: state.people,
      }),
      selectedId: route.id,
      hashFor: reviewHash,
      actions: {
        async approve(job, form) {
          const saved = state.jobs.find((item) => item.id === job.id);
          const pin = destinationPoint(saved.job_locations.exact_lat, saved.job_locations.exact_lng, 210, Math.PI / 5);
          Object.assign(saved, {
            status: "approved",
            ...formFields(form),
            public_lat: pin.lat,
            public_lng: pin.lng,
            rejection_reason: null,
          });
        },
        async update(job, form) {
          Object.assign(state.jobs.find((item) => item.id === job.id), formFields(form));
        },
        async reject(id, reason) {
          const job = state.jobs.find((item) => item.id === id);
          job.status = "rejected";
          job.rejection_reason = reason;
        },
        async withdraw(id, reason) {
          const job = state.jobs.find((item) => item.id === id);
          job.status = "rejected";
          job.rejection_reason = reason;
        },
        async republish(id) {
          const job = state.jobs.find((item) => item.id === id);
          job.status = "approved";
          job.rejection_reason = null;
        },
        async feed() {
          return state.jobs.filter((job) => job.status === "approved" && job.public_lat != null).map((job) => toPublicJob({
            id: job.id,
            title: job.title,
            service: job.service,
            town: job.town,
            state: job.state,
            lat: job.public_lat,
            lng: job.public_lng,
            date: job.job_date,
            summary: job.summary,
            photos: (job.job_photos || []).map((photo) => photo.public_url || photo.previewUrl).filter(Boolean),
            review: job.review_name ? {
              name: job.review_name,
              stars: job.review_stars,
              text: job.review_text,
              date: job.review_date,
            } : null,
            gbpUrl: job.gbp_url,
          }));
        },
        async backup() {
          return {
            jobs: state.jobs.map((job) => ({
              ...job,
              job_date: job.job_date,
              public_lat: job.public_lat,
              public_lng: job.public_lng,
              review_name: job.review_name,
              review_stars: job.review_stars,
              review_text: job.review_text,
              review_date: job.review_date,
              gbp_url: job.gbp_url,
              rejection_reason: job.rejection_reason,
            })),
            locations: state.jobs.filter((job) => job.job_locations).map((job) => ({
              job_id: job.id,
              exact_lat: job.job_locations.exact_lat,
              exact_lng: job.job_locations.exact_lng,
              address: job.job_locations.address,
            })),
            photos: state.jobs.flatMap((job) => (job.job_photos || []).map((photo) => ({
              job_id: job.id,
              public_url: photo.public_url,
              storage_path: photo.storage_path,
              sort_order: photo.sort_order,
            }))),
          };
        },
        async import(kind, jobs) {
          let imported = 0;
          let skipped = 0;
          for (const job of jobs) {
            if (state.jobs.some((item) => item.id === job.id)) {
              skipped += 1;
              continue;
            }
            state.jobs.unshift({
              id: job.id,
              status: kind === "public" ? "approved" : (job.status || "approved"),
              service: job.service,
              town: job.town,
              state: job.state,
              title: job.title,
              summary: job.summary,
              job_date: job.date,
              public_lat: job.lat,
              public_lng: job.lng,
              review_name: job.review?.name || null,
              review_stars: job.review?.stars || null,
              review_text: job.review?.text || null,
              review_date: job.review?.date || null,
              gbp_url: job.gbpUrl,
              rejection_reason: job.rejectionReason || null,
              created_by: me.id,
              job_locations: job.exactLat == null ? null : {
                exact_lat: job.exactLat,
                exact_lng: job.exactLng,
                address: job.address,
              },
              job_photos: [],
            });
            imported += 1;
          }
          return { imported, skipped, errors: [] };
        },
      },
    });
  } else if (route.name === "crew") {
    content = renderCrew({
      profile: me,
      load: async () => state.people,
      actions: {
        async create(input) {
          state.people.push({
            id: crypto.randomUUID(),
            display_name: input.displayName,
            email: input.email,
            role: input.role,
            disabled: false,
          });
        },
        async setRole(id, role) {
          const person = state.people.find((item) => item.id === id);
          person.role = role;
        },
        async setDisabled(id, disabled) {
          const person = state.people.find((item) => item.id === id);
          person.disabled = disabled;
        },
      },
    });
  } else {
    content = renderNewJob({
      restoreDraft: false,
      submit: async (payload) => {
        const id = crypto.randomUUID();
        state.jobs.unshift({
          id,
          status: "pending",
          service: payload.fields.service,
          town: payload.fields.town,
          state: payload.fields.state,
          title: `${payload.fields.service} in ${payload.fields.town}, ${payload.fields.state}`,
          summary: payload.fields.summary,
          job_date: payload.fields.date,
          public_lat: null,
          public_lng: null,
          review_name: null,
          review_stars: null,
          review_text: null,
          review_date: null,
          gbp_url: null,
          rejection_reason: null,
          created_by: me.id,
          job_locations: {
            exact_lat: payload.location.lat,
            exact_lng: payload.location.lng,
            address: payload.location.address,
          },
          job_photos: payload.photos.map((photo, index) => ({
            id: crypto.randomUUID(),
            storage_path: "",
            public_url: URL.createObjectURL(photo.blob),
            sort_order: index,
          })),
        });
        location.hash = "#/preview/posts";
      },
    });
  }

  const banner = el("div", { class: "sample-banner" }, [
    el("p", { text: "Sample only. Nothing is saved." }),
    el("div", { class: "row" }, ["crew", "approver", "admin"].map((role) => el("button", {
      type: "button",
      class: state.role === role ? "btn small primary" : "btn small",
      dataset: { testid: `role-${role}` },
      text: role[0].toUpperCase() + role.slice(1),
      onclick: () => {
        state.role = role;
        rerender();
      },
    }))),
  ]);
  const shell = renderShell({
    profile: me,
    active: route.name === "posts" || route.name === "review" || route.name === "crew" ? route.name : "new",
    hashFor,
    banner,
    signOutLabel: "Close preview",
    onSignOut: () => { location.hash = "#/"; },
    content,
  });
  shell._leave = () => content._leave?.();
  return shell;
}

function formFields(form) {
  return {
    service: form.service,
    town: form.town,
    state: form.state,
    title: form.title,
    summary: form.summary,
    job_date: form.date,
    review_name: form.reviewName,
    review_stars: form.reviewStars,
    review_text: form.reviewText,
    review_date: form.reviewDate,
    gbp_url: form.gbpUrl,
  };
}
