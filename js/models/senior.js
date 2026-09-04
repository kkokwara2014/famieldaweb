function asList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function createEmergencyContact(data = {}) {
  return {
    id: data.id ?? "",
    name: data.name ?? "",
    relationship: data.relationship ?? "",
    phone: data.phone ?? "",
    email: data.email ?? "",
    isPrimary: Boolean(data.isPrimary),
  };
}

export function createCarePreferences(data = {}) {
  return {
    preferredLanguage: data.preferredLanguage ?? "",
    mobility: data.mobility ?? "",
    diet: data.diet ?? "",
    communication: data.communication ?? "",
    dailyRoutine: data.dailyRoutine ?? "",
    likes: data.likes ?? "",
    dislikes: data.dislikes ?? "",
    notes: data.notes ?? "",
  };
}

export function createImportantInfo(data = {}) {
  return {
    bloodType: data.bloodType ?? "",
    primaryPhysician: data.primaryPhysician ?? "",
    physicianPhone: data.physicianPhone ?? "",
    pharmacy: data.pharmacy ?? "",
    insuranceProvider: data.insuranceProvider ?? "",
    insuranceId: data.insuranceId ?? "",
    hospitalPreference: data.hospitalPreference ?? "",
    medicalNotes: data.medicalNotes ?? "",
    other: data.other ?? "",
  };
}

export function createCareStatus(data = {}) {
  return {
    status: data.status ?? "stable",
    summary: data.summary ?? "",
    updatedAt: data.updatedAt ?? null,
    coverageNote: data.coverageNote ?? "",
  };
}

export function createSenior(data = {}) {
  const displayName = data.displayName || data.name || data.fullName || data.seniorName || "";
  const ownerId = data.ownerId || data.owner_id || data.createdBy || "";
  const memberIds = Array.isArray(data.memberIds)
    ? data.memberIds.filter(Boolean)
    : Array.isArray(data.members)
      ? data.members.map((item) => (typeof item === "string" ? item : item?.id || item?.userId || "")).filter(Boolean)
      : ownerId
        ? [ownerId]
        : [];

  return {
    id: data.id ?? "",
    ownerId,
    memberIds,
    displayName,
    preferredName: data.preferredName || displayName,
    dateOfBirth: data.dateOfBirth || data.dob || data.date_of_birth || "",
    gender: data.gender ?? "",
    phone: data.phone ?? "",
    location: data.location ?? "",
    address: data.address ?? "",
    photoURL: data.photoURL || data.photoUrl || data.imageUrl || null,
    conditions: asList(data.conditions),
    medications: asList(data.medications),
    allergies: asList(data.allergies),
    emergencyContacts: (data.emergencyContacts ?? []).map((contact) => createEmergencyContact(contact)),
    carePreferences: createCarePreferences(data.carePreferences),
    importantInfo: createImportantInfo(data.importantInfo),
    care: createCareStatus(data.care),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    createdPlatform: data.createdPlatform ?? null,
  };
}
