import React from 'react';
import { Modal, View, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { Perfil } from '../types';

interface Props {
  visible: boolean;
  usuarios: Perfil[];
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  primaryColor?: string;
  titulo?: string;
  subtitulo?: string;
}

/**
 * Modal para elegir qué nombre aparece en un documento PDF
 * (ej. "PERSONA QUE ENTREGA" en contratos, "Cobrador" en colectas),
 * en vez de usar automáticamente el nombre del usuario con sesión iniciada.
 */
export default function ModalPersonaEntrega({
  visible, usuarios, value, onChange, onConfirm, onCancel, loading,
  primaryColor = '#1b5e20',
  titulo = '¿Quién aparece en el documento?',
  subtitulo = 'Este nombre se usará en el documento generado.',
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={st.overlay} pointerEvents="box-none">
        <View style={st.box}>
          <Text style={st.tit}>{titulo}</Text>
          <Text style={st.sub}>{subtitulo}</Text>
          <ScrollView style={{ maxHeight: 240 }}>
            {usuarios.map(u => (
              <TouchableOpacity key={u.id} onPress={() => onChange(u.nombre)}
                style={[st.opcion, { backgroundColor: value === u.nombre ? primaryColor : '#f0f0f0' }]}>
                <Text style={{ color: value === u.nombre ? '#fff' : '#333', fontWeight: value === u.nombre ? '700' : '400' }}>
                  {u.nombre}{u.rol ? `  ·  ${u.rol}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={st.label}>O escribe otro nombre:</Text>
          <TextInput mode="outlined" dense value={value} onChangeText={onChange}
            placeholder="Nombre completo" style={{ marginBottom: 12 }} />
          <View style={st.btns}>
            <Button mode="outlined" onPress={onCancel} style={{ flex: 1 }}>Cancelar</Button>
            <Button mode="contained" onPress={onConfirm} disabled={!value.trim()} loading={loading}
              style={{ flex: 1, backgroundColor: '#4caf50' }}>
              Generar
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: '#fff', borderRadius: 12, padding: 18, maxWidth: 480, width: '100%', alignSelf: 'center' },
  tit: { fontSize: 16, fontWeight: '700', marginBottom: 6, color: '#222' },
  sub: { color: '#555', marginBottom: 12, fontSize: 13 },
  opcion: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 6 },
  label: { color: '#777', marginTop: 8, marginBottom: 4, fontSize: 12 },
  btns: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
