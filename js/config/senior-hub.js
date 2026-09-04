export const SENIOR_HUB_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    href: "senior.html",
    summary: "Profile, care status, and a snapshot of the day.",
  },
  {
    id: "care-plan",
    label: "Care Plan",
    href: "senior.html?section=care-plan",
    summary: "Goals, assigned work, frequency, and what has been completed.",
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "senior.html?section=tasks",
    summary: "Create, assign, and complete care work — with priority, due dates, and notes.",
  },
  {
    id: "schedule",
    label: "Schedule",
    href: "senior.html?section=schedule",
    summary: "The shared week around this person.",
  },
  {
    id: "caregivers",
    label: "Caregivers",
    href: "senior.html?section=caregivers",
    summary: "Who is on duty and covering home care.",
  },
  {
    id: "practitioners",
    label: "Health Practitioners",
    href: "senior.html?section=practitioners",
    summary: "Nurses, physicians, and therapists on the record.",
  },
  {
    id: "medications",
    label: "Medications",
    href: "senior.html?section=medications",
    summary: "A shared care list — name, dosage, frequency, dates, reminders, and history. Plus.",
  },
  {
    id: "appointments",
    label: "Appointments",
    href: "senior.html?section=appointments",
    summary: "Create, edit, and cancel visits — with reminders, status, and the clinician on the record.",
  },
  {
    id: "history",
    label: "Care History",
    href: "senior.html?section=history",
    summary: "A chronological timeline of check-ins, tasks, medications, and notes. Plus.",
  },
  {
    id: "reports",
    label: "Reports",
    href: "senior.html?section=reports",
    summary: "A care summary for everyone. Plus adds activity, trends, export, and PDF.",
  },
  {
    id: "documents",
    label: "Documents",
    href: "senior.html?section=documents",
    summary: "A private household vault — upload, preview, and share by permission. Plus.",
  },
  {
    id: "messages",
    label: "Messages",
    href: "senior.html?section=messages",
    summary: "Family talks privately with the caregiver, nurse, physiotherapist, or MD on this circle.",
  },
];

export function seniorHubSection(id) {
  return SENIOR_HUB_SECTIONS.find((item) => item.id === id) ?? SENIOR_HUB_SECTIONS[0];
}

export function currentSeniorSection(search = window.location.search) {
  const requested = new URLSearchParams(search).get("section") || "overview";
  return seniorHubSection(requested);
}

export function currentSeniorMode(search = window.location.search) {
  return new URLSearchParams(search).get("mode") || "view";
}

export function seniorHubHref(section = "overview", extra = {}) {
  const params = new URLSearchParams();
  if (section && section !== "overview") params.set("section", section);
  if (extra.mode && extra.mode !== "view") params.set("mode", extra.mode);
  if (extra.hash) return withQuery("senior.html", params) + extra.hash;
  return withQuery("senior.html", params);
}

export function seniorHubTitle(section = currentSeniorSection(), mode = currentSeniorMode()) {
  if (mode === "create") return "Create senior";
  if (mode === "edit") return "Edit senior";
  return section.label;
}

export function seniorHubCrumbs(section = currentSeniorSection(), mode = currentSeniorMode()) {
  if (mode === "create") return ["Create senior"];
  if (mode === "edit") {
    return [{ label: "Senior", href: "senior.html" }, "Edit profile"];
  }
  return [{ label: "Senior", href: "senior.html" }, section.label];
}

function withQuery(path, params) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
