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
  if (typeof data === "string") return { notes: data };
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
  const createdBy = data.createdBy || ownerId || "";
  const photoUrl = data.photoUrl || data.photoURL || data.imageUrl || null;
  const memberIds = Array.isArray(data.memberIds)
    ? data.memberIds.filter(Boolean)
    : Array.isArray(data.members)
      ? data.members.map((item) => (typeof item === "string" ? item : item?.id || item?.userId || "")).filter(Boolean)
      : ownerId
        ? [ownerId]
        : [];
  const importantInfo = createImportantInfo(data.importantInfo);
  const address = data.address ?? data.location ?? "";
  const location = data.location ?? (typeof address === "string" ? address : "");

  return {
    id: data.id ?? "",
    // Mobile-canonical fields (the mobile app reads these names).
    createdBy,
    familyId: data.familyId ?? "",
    status: data.status ?? "active",
    name: displayName,
    photoUrl,
    preferredHospital: data.preferredHospital ?? importantInfo.hospitalPreference ?? "",
    primaryPhysician: data.primaryPhysician ?? importantInfo.primaryPhysician ?? "",
    mobilityInfo: data.mobilityInfo ?? "",
    dietaryRequirements: data.dietaryRequirements ?? "",
    emergencyInformation: data.emergencyInformation ?? {},
    notes: data.notes ?? "",
    linkedUserId: data.linkedUserId ?? null,
    // Web fields (kept; derived from the canonical ones above).
    ownerId,
    memberIds,
    displayName,
    preferredName: data.preferredName || displayName,
    dateOfBirth: data.dateOfBirth || data.dob || data.date_of_birth || "",
    gender: data.gender ?? "",
    phone: data.phone ?? "",
    location,
    address,
    photoURL: photoUrl,
    conditions: asList(data.conditions),
    medications: asList(data.medications),
    allergies: asList(data.allergies),
    emergencyContacts: (data.emergencyContacts ?? []).map((contact) => createEmergencyContact(contact)),
    carePreferences: createCarePreferences(data.carePreferences),
    importantInfo,
    care: createCareStatus(data.care),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    createdPlatform: data.createdPlatform ?? null,
  };
}
