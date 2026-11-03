import type { QueryClient } from '@tanstack/react-query';
import type { Board } from '@flowboard/contracts';
import { discardRefusedRows } from './feed-state.ts';
import { redactProtectedDrafts } from './protected-drafts.ts';

/** A successful empty list is authoritative too: discard copies of boards omitted from the new list. */
export async function readPortfolioBoards(client:QueryClient,projectId:string,read:()=>Promise<{data:Board[]}>,key:readonly unknown[]=['boards',projectId]) {
  const before=client.getQueryData<Board[]>(key)??[];
  const remove=async(boards:Board[])=>{for(const board of boards){redactProtectedDrafts({boardId:board.id});const matches=(query:{queryKey:readonly unknown[]})=>['board','board-stats'].includes(String(query.queryKey[0]))&&query.queryKey[1]===board.id;await client.cancelQueries({predicate:matches});client.removeQueries({predicate:matches});}};
  try {
    const next=(await read()).data;
    const visible=new Set(next.map((board)=>board.id));
    await remove(before.filter((board)=>!visible.has(board.id)));
    return next;
  }catch(error){if(discardRefusedRows(client,key,error)){redactProtectedDrafts({projectId});await remove(before);}throw error;}
}
export function portfolioPollKeys(projectIds:readonly string[],boardIds:readonly string[]){return [...projectIds.map((id)=>['boards',id]),...boardIds.map((id)=>['board-stats',id])];}
