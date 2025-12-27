import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

export {
    // Catch any errors thrown by the Layout component.
    ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Custom dark theme matching DeltaWatch colors
const DeltaWatchDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#238636',
    background: '#0d1117',
    card: '#161b22',
    text: '#c9d1d9',
    border: '#30363d',
    notification: '#238636',
  },
};

const DeltaWatchLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#1a7f37',
    background: '#ffffff',
    card: '#f6f8fa',
    text: '#1f2328',
    border: '#d0d7de',
    notification: '#1a7f37',
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemeProvider>
      <RootLayoutNav />
    </ThemeProvider>
  );
}

function RootLayoutNav() {
  const { resolvedTheme, colors } = useTheme();
  const navigationTheme = resolvedTheme === 'dark' ? DeltaWatchDarkTheme : DeltaWatchLightTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NavigationThemeProvider value={navigationTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen 
              name="monitor/[id]" 
              options={{ 
                headerShown: true,
                title: 'Details',
                headerStyle: { backgroundColor: colors.backgroundSecondary },
                headerTintColor: colors.text,
                headerBackTitle: 'Back',
              }} 
            />
            <Stack.Screen 
              name="login" 
              options={{ 
                headerShown: false,
                presentation: 'modal',
              }} 
            />
            <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
          </Stack>
        </NavigationThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
