import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/useToast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthCard } from '@/components/auth/AuthCard';
import InputField from '@/components/ui/InputField';
import PasswordInput from '@/components/ui/PasswordInput';
import LoadingButton from '@/components/ui/LoadingButton';
import { validateEmail, validatePassword, validateConfirmPassword, getPasswordStrength } from '@/utils/validation';
import { useAuth } from '@/hooks/useAuth';

function emailError(value) {
  if (!value.trim()) return 'Email is required';
  if (!validateEmail(value)) return 'Invalid email format';
  return '';
}

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { register, registerError } = useAuth();
  const [formData, setFormData] = useState({ email: '', username: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      let err = '';
      if (name === 'email') err = emailError(value);
      else if (name === 'username') err = !value.trim() ? 'Username is required' : '';
      else if (name === 'password') {
        err = validatePassword(value);
        if (!err) {
          const { strength } = getPasswordStrength(value);
          if (strength === 'weak') err = 'Please use a stronger password';
        }
      } else if (name === 'confirmPassword') err = validateConfirmPassword(formData.password, value);
      setErrors((prev) => ({ ...prev, [name]: err }));
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    let err = '';
    if (name === 'email') err = emailError(value);
    else if (name === 'username') err = !value.trim() ? 'Username is required' : '';
    else if (name === 'password') {
      err = validatePassword(value);
      if (!err) {
        const { strength } = getPasswordStrength(value);
        if (strength === 'weak') err = 'Please use a stronger password';
      }
    } else if (name === 'confirmPassword') err = validateConfirmPassword(formData.password, value);
    setErrors((prev) => ({ ...prev, [name]: err }));
  };

  const validateForm = () => {
    const newErrors = {};
    const e = emailError(formData.email);
    if (e) newErrors.email = e;
    if (!formData.username.trim()) newErrors.username = 'Username is required';
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
    setTouched({ email: true, username: true, password: true, confirmPassword: true });
    if (!validateForm()) return;

    setLoading(true);
    try {
      await register({ email: formData.email.trim(), username: formData.username.trim(), password: formData.password });
      toast({ title: 'Account created! Welcome to Relay.' });
      setLocation('/chat');
    } catch {
      // error in registerError
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard title="Welcome to Relay!" subtitle="Fast, reliable, real-time messaging.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <InputField
            id="email"
            name="email"
            type="email"
            label="Email"
            placeholder="Enter your email"
            value={formData.email}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.email && errors.email}
            disabled={loading}
            data-testid="signup-email-input"
          />
          <InputField
            id="username"
            name="username"
            type="text"
            label="Username"
            placeholder="Choose a username"
            value={formData.username}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.username && errors.username}
            disabled={loading}
            data-testid="signup-username-input"
          />
          <PasswordInput
            id="password"
            name="password"
            label="Password"
            placeholder="Create a password"
            value={formData.password}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.password && errors.password}
            showStrength
            disabled={loading}
            data-testid="signup-password-input"
          />
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm Password"
            placeholder="Confirm your password"
            value={formData.confirmPassword}
            onChange={handleChange}
            onBlur={handleBlur}
            error={touched.confirmPassword && errors.confirmPassword}
            disabled={loading}
            data-testid="signup-confirm-password-input"
          />
          {registerError && <p className="text-sm text-red-600 dark:text-red-400">{registerError}</p>}
          <LoadingButton type="submit" loading={loading} loadingText="Creating account..." data-testid="signup-submit-button">
            Sign Up
          </LoadingButton>
        </form>
        <div className="text-center text-sm mt-4">
          <span className="text-gray-600 dark:text-gray-400">Already have an account? </span>
          <Link href="/login" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium" data-testid="signup-login-link">
            Log in
          </Link>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
