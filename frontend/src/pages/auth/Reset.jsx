import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/useToast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthCard } from '@/components/auth/AuthCard';
import PasswordInput from '@/components/ui/PasswordInput';
import LoadingButton from '@/components/ui/LoadingButton';
import { validatePassword, validateConfirmPassword, getPasswordStrength } from '@/utils/validation';
import { resetPassword } from '@/http/password.api';

function getQueryParams() {
  if (typeof window === 'undefined') return { email: '', otp: '' };
  const q = new URLSearchParams(window.location.search);
  return { email: q.get('email') || '', otp: q.get('otp') || '' };
}

export default function Reset() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { email, otp } = getQueryParams();
  const [formData, setFormData] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email || !otp) setLocation('/forgot');
  }, [email, otp, setLocation]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      let err = '';
      if (name === 'password') {
        err = validatePassword(value);
        if (!err) {
          const { strength } = getPasswordStrength(value);
          if (strength === 'weak') err = 'Please use a stronger password';
        }
      } else err = validateConfirmPassword(formData.password, value);
      setErrors((prev) => ({ ...prev, [name]: err }));
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    let err = '';
    if (name === 'password') {
      err = validatePassword(value);
      if (!err) {
        const { strength } = getPasswordStrength(value);
        if (strength === 'weak') err = 'Please use a stronger password';
      }
    } else err = validateConfirmPassword(formData.password, value);
    setErrors((prev) => ({ ...prev, [name]: err }));
  };

  const validateForm = () => {
    const newErrors = {};
    const passwordError = validatePassword(formData.password);
    if (passwordError) newErrors.password = passwordError;
    else {
      const { strength } = getPasswordStrength(formData.password);
      if (strength === 'weak') newErrors.password = 'Please use a stronger password';
    }
    const confirmError = validateConfirmPassword(formData.password, formData.confirmPassword);
    if (confirmError) newErrors.confirmPassword = confirmError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });
    if (!validateForm()) return;
    setLoading(true);
    try {
      await resetPassword(email, otp, formData.password);
      toast({ title: 'Password reset successfully.' });
      setLocation('/login');
    } catch (err) {
      toast({ title: err.message || 'Reset failed.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!email || !otp) return null;

  return (
    <AuthLayout>
      <AuthCard title="Reset Password" subtitle="Create a new password for your account.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordInput
            id="password"
            name="password"
            label="New Password"
            placeholder="Enter new password"
            value={formData.password}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.password && errors.password}
            showStrength
            disabled={loading}
            data-testid="reset-password-input"
          />
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm Password"
            placeholder="Confirm new password"
            value={formData.confirmPassword}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.confirmPassword && errors.confirmPassword}
            disabled={loading}
            data-testid="reset-confirm-password-input"
          />
          <LoadingButton loading={loading} loadingText="Resetting password..." data-testid="reset-password-submit-button">
            Reset Password
          </LoadingButton>
        </form>
        <div className="text-center text-sm mt-4">
          <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
            Back to Sign In
          </Link>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
