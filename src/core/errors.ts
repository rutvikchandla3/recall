export class RecallError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RecallError';
  }
}

export class ConfigError extends RecallError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export class DoctorError extends RecallError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DoctorError';
  }
}
