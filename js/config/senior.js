export const SENIOR_GENDERS = [
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
  { id: "nonbinary", label: "Non-binary" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
];

export const SENIOR_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "fr", label: "French" },
  { id: "es", label: "Spanish" },
  { id: "yo", label: "Yoruba" },
  { id: "ig", label: "Igbo" },
  { id: "ha", label: "Hausa" },
  { id: "other", label: "Other" },
];

export const SENIOR_MOBILITY = [
  { id: "independent", label: "Independent" },
  { id: "cane", label: "Uses a cane" },
  { id: "walker", label: "Uses a walker" },
  { id: "wheelchair", label: "Uses a wheelchair" },
  { id: "assistance", label: "Needs assistance" },
];

export const SENIOR_DIETS = [
  { id: "none", label: "No restrictions" },
  { id: "low_sodium", label: "Low sodium" },
  { id: "diabetic", label: "Diabetic" },
  { id: "soft", label: "Soft foods" },
  { id: "other", label: "Other" },
];

export const SENIOR_COMMUNICATION = [
  { id: "verbal", label: "Verbal" },
  { id: "limited_verbal", label: "Limited verbal" },
  { id: "nonverbal", label: "Non-verbal" },
  { id: "hearing_support", label: "Needs hearing support" },
];

export const SENIOR_BLOOD_TYPES = [
  { id: "O+", label: "O+" },
  { id: "O-", label: "O-" },
  { id: "A+", label: "A+" },
  { id: "A-", label: "A-" },
  { id: "B+", label: "B+" },
  { id: "B-", label: "B-" },
  { id: "AB+", label: "AB+" },
  { id: "AB-", label: "AB-" },
  { id: "unknown", label: "Unknown" },
];

export function optionLabel(options, id, fallback = "Not recorded") {
  if (!id) return fallback;
  return options.find((item) => item.id === id)?.label ?? id;
}

export function formatSeniorAge(dateOfBirth) {
  if (!dateOfBirth) return "";
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const month = now.getMonth() - dob.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age -= 1;
  if (age < 0 || age > 130) return "";
  return `${age} years old`;
}

export function formatSeniorDate(dateOfBirth) {
  if (!dateOfBirth) return "";
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return dateOfBirth;
  return dob.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
