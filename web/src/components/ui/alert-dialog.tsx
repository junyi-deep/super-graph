import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "../../lib/utils";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export function AlertDialogContent({
  className,
  ...props
}: AlertDialogPrimitive.AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="sg-dialog-overlay" />
      <AlertDialogPrimitive.Content
        className={cn("sg-dialog-content sg-alert-dialog-content", className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}
export function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sg-dialog-header", className)} {...props} />;
}
export function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sg-dialog-footer", className)} {...props} />;
}
export function AlertDialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.AlertDialogTitleProps) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("sg-dialog-title", className)}
      {...props}
    />
  );
}
export function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.AlertDialogDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("sg-dialog-description", className)}
      {...props}
    />
  );
}
