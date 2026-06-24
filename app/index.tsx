import { Redirect } from 'expo-router';
import { useAuth } from '../src/hooks/useAuth';
import { View, ActivityIndicator } from 'react-native';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return (
    <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#051208' }}>
      <ActivityIndicator color="#69f0ae" size="large" />
    </View>
  );
  return <Redirect href={user ? '/(app)' : '/(auth)/login'} />;
}
