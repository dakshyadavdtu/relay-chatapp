// Validation utilities for auth forms

export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const getPasswordStrength = (password) => {
  if (!password) return { strength: 'none', score: 0 };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (score <= 2) return { strength: 'weak', score: 1 };
  if (score <= 4) return { strength: 'medium', score: 2 };
  return { strength: 'strong', score: 3 };
};

export const maskEmail = (email) => {
  if (!email) return '';
  const parts = email.split('@');
  if (!parts[1]) return email;
  return parts[0].charAt(0) + '****@' + parts[1];
};

export const validatePassword = (password) => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return '';
};

export const validateConfirmPassword = (password, confirmPassword) => {
  if (!confirmPassword) return 'Please confirm your password';
  if (password !== confirmPassword) return 'Passwords do not match';
  return '';
};
