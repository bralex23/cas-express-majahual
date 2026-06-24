import { Redirect } from 'expo-router';

/**
 * En el sistema standalone Majahual no existe selección de empresa.
 * Este componente redirige directamente al área principal de la app.
 */
export default function SelectEmpresa() {
  return <Redirect href="/(app)" />;
}
