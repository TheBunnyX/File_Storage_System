// Static definitions shared by the SQLite and MySQL backends.
export const WORKSPACE_INDEXES = [
  {name:'files_owner_deleted_modified',table:'files',columns:'owner_id,deleted,modified'},
  {name:'files_folder_deleted',table:'files',columns:'folder_id,deleted'},
  {name:'shares_recipient_permission',table:'shares',columns:'user_id,kind,resource_id,permission'},
  {name:'shares_resource',table:'shares',columns:'kind,resource_id'},
  {name:'activities_owner_recent',table:'activities',columns:'owner_id,id'},
] as const;
