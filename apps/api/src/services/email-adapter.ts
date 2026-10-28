export interface SendInvitationEmailOptions {
  to: string;
  role: string;
  projectId: string;
  invitationId: string;
}

export interface EmailAdapterResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailAdapter {
  sendInvitationEmail(options: SendInvitationEmailOptions): Promise<EmailAdapterResult>;
}

export class ConfiguredEmailAdapter implements EmailAdapter {
  private simulateFailure = false;
  public sentEmails: SendInvitationEmailOptions[] = [];

  setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  async sendInvitationEmail(options: SendInvitationEmailOptions): Promise<EmailAdapterResult> {
    if (this.simulateFailure) {
      return { success: false, error: 'SMTP connection timeout' };
    }
    this.sentEmails.push(options);
    return { success: true, messageId: `msg_${Date.now()}` };
  }
}

export const emailAdapter = new ConfiguredEmailAdapter();
