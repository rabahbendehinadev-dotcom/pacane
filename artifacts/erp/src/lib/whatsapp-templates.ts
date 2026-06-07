export interface WhatsappTemplate {
  id: string;
  name: string;
  message: string;
}

const STORAGE_KEY = "pacane_whatsapp_templates";

const DEFAULT_TEMPLATES: WhatsappTemplate[] = [
  {
    id: "default-1",
    name: "Merci pour l'achat",
    message: "Merci {{client}} pour votre achat de {{montant}} DA ({{ref}}) chez Pacane 🎂 Nous espérons vous revoir bientôt !",
  },
  {
    id: "default-2",
    name: "Confirmation commande",
    message: "Bonjour {{client}}, votre commande {{ref}} d'un montant de {{montant}} DA a bien été enregistrée. Merci de votre confiance ! 🙏",
  },
];

export function loadTemplates(): WhatsappTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_TEMPLATES));
      return DEFAULT_TEMPLATES;
    }
    return JSON.parse(raw) as WhatsappTemplate[];
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

export function saveTemplates(templates: WhatsappTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function applyVariables(
  message: string,
  vars: { client?: string; montant?: string; ref?: string }
): string {
  return message
    .replace(/\{\{client\}\}/g, vars.client ?? "")
    .replace(/\{\{montant\}\}/g, vars.montant ?? "")
    .replace(/\{\{ref\}\}/g, vars.ref ?? "");
}

export function buildWhatsappUrl(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  const international = cleaned.startsWith("0") ? "213" + cleaned.slice(1) : cleaned;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}
