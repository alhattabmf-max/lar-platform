export interface CapturedEmail {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

const store: CapturedEmail[] = [];

export function getCapturedEmails(): CapturedEmail[] {
  return store;
}

export function pushCapturedEmail(email: CapturedEmail): void {
  store.push(email);
}
