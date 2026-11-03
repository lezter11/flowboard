import {isValidGregorianDate} from '@flowboard/contracts';

/** Validate without converting: Date normalizes impossible calendars and discards microseconds. */
export function isCursorTimestamp(value:unknown):value is string {
  if(typeof value!=='string'||value.length>27)return false;
  const match=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?Z$/.exec(value);
  return match!==null&&isValidGregorianDate(match[1]!);
}

/** PostgreSQL TEXT excludes NUL; lone surrogates are not valid Unicode text. */
export function isCursorText(value:unknown):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=4096&&!value.includes('\u0000')&&
    !Array.from(value).some((character)=>character.length===1&&/[\uD800-\uDFFF]/.test(character));
}
