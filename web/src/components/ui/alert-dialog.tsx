import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "../../lib/utils";

export const AlertDialog=AlertDialogPrimitive.Root;
export const AlertDialogAction=AlertDialogPrimitive.Action;
export const AlertDialogCancel=AlertDialogPrimitive.Cancel;
export function AlertDialogContent({className,...props}:AlertDialogPrimitive.AlertDialogContentProps){return <AlertDialogPrimitive.Portal><AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"/><AlertDialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl outline-none",className)} {...props}/></AlertDialogPrimitive.Portal>}
export function AlertDialogHeader(props:React.HTMLAttributes<HTMLDivElement>){return <div className="grid gap-2" {...props}/>}
export function AlertDialogFooter(props:React.HTMLAttributes<HTMLDivElement>){return <div className="flex justify-end gap-2" {...props}/>}
export function AlertDialogTitle({className,...props}:AlertDialogPrimitive.AlertDialogTitleProps){return <AlertDialogPrimitive.Title className={cn("text-lg font-semibold",className)} {...props}/>}
export function AlertDialogDescription({className,...props}:AlertDialogPrimitive.AlertDialogDescriptionProps){return <AlertDialogPrimitive.Description className={cn("text-sm text-zinc-500",className)} {...props}/>}
