import { IRuntimeEvent } from "./IRuntimeEvent";

export interface IActionButton {
  label?: string;
  icon?: React.ForwardRefExoticComponent<
    React.PropsWithoutRef<React.SVGProps<SVGSVGElement>> & {
      title?: string;
      titleId?: string;
    } & React.RefAttributes<SVGSVGElement>
  >;
  event: string;
  isActive?: boolean;
  variant?: "primary" | "secondary" | "success";
  onClick: () => IRuntimeEvent[];
}
