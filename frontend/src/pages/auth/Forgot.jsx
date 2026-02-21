import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/useToast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthCard } from '@/components/auth/AuthCard';
import InputField from '@/components/ui/InputField';
import LoadingButton from '@/components/ui/LoadingButton';
import { validateEmail } from '@/utils/validation';
import { forgotPassword } from '@/http/password.api';

export default function Forgot() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setEmail(e.target.value);
    if (touched) {
      const v = e.target.value.trim();
      setError(!v ? 'Email is required' : !validateEmail(v) ? 'Invalid email format' : '');
    }
  };

  const handleBlur = () => {
    setTouched(true);
    const v = email.trim();
    setError(!v ? 'Email is required' : !validateEmail(v) ? 'Invalid email format' : '');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    const v = email.trim();
    if (!v) {
      setError('Email is required');
      return;
    }
    if (!validateEmail(v)) {
      setError('Invalid email format');
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(v);
      toast({ title: 'If this email is registered, a code has been sent.' });
      setLocation('/verify-otp?email=' + encodeURIComponent(v));
    } catch (err) {
      toast({ title: err.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard title="Forgot Password?" subtitle="Enter your email to receive a reset code.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <InputField
            id="email"
            name="email"
            type="email"
            label="Email"
            placeholder="Enter your email"
            value={email}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched && error}
            disabled={loading}
            data-testid="forgot-password-email-input"
          />
          <LoadingButton type="submit" loading={loading} loadingText="Sending OTP..." data-testid="forgot-password-submit-button">
            Send OTP
          </LoadingButton>
        </form>
        <div className="text-center text-sm mt-4">
          <span className="text-gray-600 dark:text-gray-400">Remember your password? </span>
          <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium" data-testid="forgot-password-login-link">
            Log in
          </Link>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
