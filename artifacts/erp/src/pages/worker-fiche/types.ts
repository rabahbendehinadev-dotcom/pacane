export interface WorkerDocument {
  id: number;
  workerId: number;
  category: string;
  label: string;
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  uploadedAt: string;
  uploadedByUserId: number | null;
}

export interface WorkerSkill {
  id: number;
  workerId: number;
  skill: string;
  level: string | null;
  yearsExperience: number | null;
  certification: string | null;
  createdAt: string;
}

export interface WorkerActivityLog {
  id: number;
  workerId: number;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  performedByUserId: number | null;
  performedByName: string | null;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

export interface WorkerProfile {
  id: number;
  name: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  lastName: string | null;
  firstName: string | null;
  photoUrl: string | null;
  birthDate: string | null;
  gender: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  nationalId: string | null;
  maritalStatus: string | null;
  childrenCount: number | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;

  hireDate: string | null;
  position: string | null;
  department: string | null;
  contractType: string | null;
  baseSalary: string | null;
  commissionRate: string | null;
  workHours: string | null;
  restDays: string | null;

  hasChronicDisease: boolean | null;
  chronicDiseaseDetails: string | null;
  takesMedication: boolean | null;
  allergies: string | null;
  bloodType: string | null;
  medicalNotes: string | null;

  notes: string | null;
  meta: Record<string, unknown> | null;

  productCount: number;
  documents: WorkerDocument[];
  skills: WorkerSkill[];
  recentActivity: WorkerActivityLog[];
}

export interface EditForm {
  name: string;
  lastName: string;
  firstName: string;
  birthDate: string;
  gender: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  nationalId: string;
  maritalStatus: string;
  childrenCount: string;
  emergencyContact: string;
  emergencyPhone: string;
  hireDate: string;
  position: string;
  department: string;
  contractType: string;
  baseSalary: string;
  commissionRate: string;
  workHours: string;
  restDays: string;
  hasChronicDisease: boolean;
  chronicDiseaseDetails: string;
  takesMedication: boolean;
  allergies: string;
  bloodType: string;
  medicalNotes: string;
  notes: string;
}

export function profileToForm(w: WorkerProfile): EditForm {
  return {
    name: w.name ?? "",
    lastName: w.lastName ?? "",
    firstName: w.firstName ?? "",
    birthDate: w.birthDate ? w.birthDate.slice(0, 10) : "",
    gender: w.gender ?? "",
    phone: w.phone ?? "",
    whatsapp: w.whatsapp ?? "",
    email: w.email ?? "",
    address: w.address ?? "",
    city: w.city ?? "",
    nationalId: w.nationalId ?? "",
    maritalStatus: w.maritalStatus ?? "",
    childrenCount: w.childrenCount != null ? String(w.childrenCount) : "",
    emergencyContact: w.emergencyContact ?? "",
    emergencyPhone: w.emergencyPhone ?? "",
    hireDate: w.hireDate ? w.hireDate.slice(0, 10) : "",
    position: w.position ?? "",
    department: w.department ?? "",
    contractType: w.contractType ?? "",
    baseSalary: w.baseSalary ?? "",
    commissionRate: w.commissionRate ?? "",
    workHours: w.workHours ?? "",
    restDays: w.restDays ?? "",
    hasChronicDisease: w.hasChronicDisease ?? false,
    chronicDiseaseDetails: w.chronicDiseaseDetails ?? "",
    takesMedication: w.takesMedication ?? false,
    allergies: w.allergies ?? "",
    bloodType: w.bloodType ?? "",
    medicalNotes: w.medicalNotes ?? "",
    notes: w.notes ?? "",
  };
}

export function formToPayload(f: EditForm): Record<string, unknown> {
  return {
    name: f.name.trim(),
    lastName: f.lastName.trim() || null,
    firstName: f.firstName.trim() || null,
    birthDate: f.birthDate || null,
    gender: f.gender || null,
    phone: f.phone.trim() || null,
    whatsapp: f.whatsapp.trim() || null,
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    city: f.city.trim() || null,
    nationalId: f.nationalId.trim() || null,
    maritalStatus: f.maritalStatus || null,
    childrenCount: f.childrenCount !== "" ? parseInt(f.childrenCount, 10) : null,
    emergencyContact: f.emergencyContact.trim() || null,
    emergencyPhone: f.emergencyPhone.trim() || null,
    hireDate: f.hireDate || null,
    position: f.position.trim() || null,
    department: f.department.trim() || null,
    contractType: f.contractType || null,
    baseSalary: f.baseSalary || null,
    commissionRate: f.commissionRate || null,
    workHours: f.workHours.trim() || null,
    restDays: f.restDays.trim() || null,
    hasChronicDisease: f.hasChronicDisease,
    chronicDiseaseDetails: f.chronicDiseaseDetails.trim() || null,
    takesMedication: f.takesMedication,
    allergies: f.allergies.trim() || null,
    bloodType: f.bloodType || null,
    medicalNotes: f.medicalNotes.trim() || null,
    notes: f.notes.trim() || null,
  };
}

export const DOCUMENT_CATEGORIES: { value: string; label: string }[] = [
  { value: "id_card", label: "Carte d'identité" },
  { value: "contract", label: "Contrat de travail" },
  { value: "certificate", label: "Certificat / Diplôme" },
  { value: "driving_license", label: "Permis de conduire" },
  { value: "other", label: "Autre document" },
];

export const SKILL_LEVELS: { value: string; label: string; color: string }[] = [
  { value: "débutant", label: "Débutant", color: "bg-slate-100 text-slate-700" },
  { value: "intermédiaire", label: "Intermédiaire", color: "bg-blue-100 text-blue-700" },
  { value: "avancé", label: "Avancé", color: "bg-emerald-100 text-emerald-700" },
  { value: "expert", label: "Expert", color: "bg-amber-100 text-amber-700" },
];

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export const CONTRACT_TYPES = ["CDI", "CDD", "Stage", "Freelance", "Intérim", "Autre"];
export const GENDERS = [{ value: "male", label: "Masculin" }, { value: "female", label: "Féminin" }];
export const MARITAL_STATUSES = [
  { value: "single", label: "Célibataire" },
  { value: "married", label: "Marié(e)" },
  { value: "divorced", label: "Divorcé(e)" },
  { value: "widowed", label: "Veuf/Veuve" },
];

export const ACTION_LABELS: Record<string, string> = {
  created: "Employé créé",
  updated: "Profil mis à jour",
  activated: "Employé réactivé",
  deactivated: "Employé désactivé",
  photo_uploaded: "Photo mise à jour",
  photo_deleted: "Photo supprimée",
  document_added: "Document ajouté",
  document_deleted: "Document supprimé",
  skill_added: "Compétence ajoutée",
  skill_updated: "Compétence modifiée",
  skill_deleted: "Compétence supprimée",
  notes_updated: "Notes mises à jour",
};
