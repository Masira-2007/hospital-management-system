declare module "lucide-react" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

  export type LucideProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
    size?: string | number;
    strokeWidth?: string | number;
    absoluteStrokeWidth?: boolean;
  };
  export type LucideIcon = ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;

  export const Activity: LucideIcon;
  export const AlertCircle: LucideIcon;
  export const ArrowDownRight: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ArrowUpRight: LucideIcon;
  export const BadgeCheck: LucideIcon;
  export const Bell: LucideIcon;
  export const BedDouble: LucideIcon;
  export const CalendarDays: LucideIcon;
  export const Check: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const CircleHelp: LucideIcon;
  export const Clock3: LucideIcon;
  export const CreditCard: LucideIcon;
  export const FlaskConical: LucideIcon;
  export const Heart: LucideIcon;
  export const HeartPulse: LucideIcon;
  export const LayoutDashboard: LucideIcon;
  export const Menu: LucideIcon;
  export const MoreHorizontal: LucideIcon;
  export const Package: LucideIcon;
  export const Plus: LucideIcon;
  export const Search: LucideIcon;
  export const Settings2: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Stethoscope: LucideIcon;
  export const UserRound: LucideIcon;
  export const Users: LucideIcon;
  export const Workflow: LucideIcon;
  export const X: LucideIcon;
}
