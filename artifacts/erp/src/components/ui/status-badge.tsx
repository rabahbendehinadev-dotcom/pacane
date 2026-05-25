import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";
  let className = "";

  switch (status.toLowerCase()) {
    case "active":
    case "completed":
    case "paid":
    case "delivered":
    case "ok":
    case "received":
      className = "bg-green-100 text-green-800 hover:bg-green-100 border-green-200";
      variant = "outline";
      break;
    case "draft":
    case "pending":
    case "planned":
    case "ordered":
      className = "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200";
      variant = "outline";
      break;
    case "in_progress":
    case "partially_paid":
    case "partially_received":
      className = "bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-200";
      variant = "outline";
      break;
    case "suspended":
    case "cancelled":
    case "out":
    case "overdue":
    case "critical":
    case "returned":
    case "blocked":
      className = "bg-red-100 text-red-800 hover:bg-red-100 border-red-200";
      variant = "outline";
      break;
    case "low":
    case "inactive":
    case "archived":
    case "closed":
      className = "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200";
      variant = "outline";
      break;
    default:
      variant = "secondary";
  }

  const formatStatus = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

  return (
    <Badge variant={variant} className={`font-medium ${className}`}>
      {formatStatus(status)}
    </Badge>
  );
}
