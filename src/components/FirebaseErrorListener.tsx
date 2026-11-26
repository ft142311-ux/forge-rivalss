'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';

/**
 * Слушатель ошибок Firebase.
 * Выводит уведомление пользователю при возникновении проблем с правами доступа.
 */
export function FirebaseErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      console.warn("[Firebase Security]:", error.message, error.context);
      
      // Показываем визуальное уведомление об ошибке доступа
      toast({
        variant: "destructive",
        title: "Ошибка доступа",
        description: "Действие ограничено правами безопасности. Попробуйте обновить страницу.",
      });
    };

    errorEmitter.on('permission-error', handleError);
    return () => errorEmitter.off('permission-error', handleError);
  }, [toast]);

  return null;
}