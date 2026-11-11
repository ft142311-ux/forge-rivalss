export function isCalendarReady(result: any) {
  return result?.success === true && result?.worldReady === true;
}

export function calendarBlockedResult(result: any) {
  return {
    success: false,
    action: 'WORLD_BUILDING',
    worldReady: false,
    calendar: result,
  };
}
