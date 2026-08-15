import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export const Dialog=DialogPrimitive.Root;
export const DialogTrigger=DialogPrimitive.Trigger;
export const DialogClose=DialogPrimitive.Close;
export function DialogContent({className,children,...props}:DialogPrimitive.DialogContentProps){return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out"/><DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl outline-none",className)} {...props}>{children}<DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label="关闭"><X className="size-4"/></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal>}
export function DialogHeader({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn("flex flex-col gap-1.5",className)} {...props}/>}
export function DialogFooter({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn("flex justify-end gap-2",className)} {...props}/>}
export function DialogTitle({className,...props}:DialogPrimitive.DialogTitleProps){return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none tracking-tight",className)} {...props}/>}
export function DialogDescription({className,...props}:DialogPrimitive.DialogDescriptionProps){return <DialogPrimitive.Description className={cn("text-sm text-zinc-500",className)} {...props}/>}
