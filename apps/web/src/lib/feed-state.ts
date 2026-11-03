import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ApiError } from './api.ts';
import { redactRefusedDrafts, redactProtectedDrafts } from './protected-drafts.ts';
/** Erase refused content without erasing the server refusal or manufacturing an empty successful answer. */
export function discardRefusedRows(client:QueryClient,key:QueryKey,error:unknown):boolean {
  if(!(error instanceof ApiError) || ![401,403,404].includes(error.status)) return false;
  if(error.status===401)redactProtectedDrafts();else redactRefusedDrafts(key);
  client.getQueryCache().find({queryKey:key,exact:true})?.setState({data:undefined});
  return true;
}
