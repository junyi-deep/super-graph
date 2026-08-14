export type SaveStatus = "saved"|"saving"|"dirty"|"error";

export class AutosaveCoordinator {
  private counter=0; private dirty=false; private saving=false; private status:SaveStatus="saved";
  constructor(private notify:(status:SaveStatus)=>void=()=>{}){}
  markChanged(){this.counter++;this.dirty=true;this.setStatus("dirty")}
  isDirty(){return this.dirty}
  getStatus(){return this.status}
  async run(save:()=>Promise<void>){
    if(!this.dirty||this.saving)return false;
    this.saving=true;const savingCounter=this.counter;this.setStatus("saving");
    try{await save();if(this.counter===savingCounter){this.dirty=false;this.setStatus("saved")}else{this.setStatus("dirty")};return true}
    catch{this.setStatus("error");return false}
    finally{this.saving=false}
  }
  private setStatus(status:SaveStatus){this.status=status;this.notify(status)}
}
