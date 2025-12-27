import { SwipeableRow } from '@/components/SwipeableRow';
import { Text, View } from '@/components/Themed';
import { api } from '@/services/api';
import { Ionicons } from '@expo/vector-icons';
import { Change, diffWords } from 'diff';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
    RefreshControl,
    View as RNView,
    ScrollView,
    StyleSheet,
    TouchableOpacity
} from 'react-native';
import { timeAgo, formatDate, cleanValue, getStatusColor, type HistoryRecord } from '@deltawatch/shared';

interface MonitorDetail {
  id: number;
  name?: string;
  url: string;
  selector: string;
  type: 'text' | 'visual';
  interval: string;
  active: boolean;
  last_check?: string;
  last_value?: string;
  tags?: string;
  retry_count?: number;
  retry_delay?: number;
  group_id?: number;
  history: HistoryRecord[];
}

// Type badge component
function TypeBadge({ type }: { type: string }) {
  const isVisual = type === 'visual';
  return (
    <RNView style={[styles.badge, isVisual ? styles.badgeVisual : styles.badgeText]}>
      <Text style={[styles.badgeLabel, isVisual ? styles.badgeLabelVisual : styles.badgeLabelText]}>
        {isVisual ? 'VISUAL' : 'TEXT'}
      </Text>
    </RNView>
  );
}

// Status badge for history items
function StatusBadge({ status }: { status: string }) {
  const color = getStatusColor(status as 'unchanged' | 'changed' | 'error');
  let bgColor = '#21262d';
  let textColor = '#8b949e';
  let label = status;
  
  if (status === 'unchanged') {
    bgColor = 'rgba(34, 197, 94, 0.15)';
    textColor = '#4ade80';
    label = 'OK';
  } else if (status === 'changed') {
    bgColor = 'rgba(234, 179, 8, 0.15)';
    textColor = '#fbbf24';
    label = 'CHANGED';
  } else if (status === 'error') {
    bgColor = 'rgba(239, 68, 68, 0.15)';
    textColor = '#f87171';
    label = 'ERROR';
  }
  
  return (
    <RNView style={[styles.statusBadge, { backgroundColor: bgColor }]}>
      <Text style={[styles.statusLabel, { color: textColor }]}>{label}</Text>
    </RNView>
  );
}

export default function MonitorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [monitor, setMonitor] = useState<MonitorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [filter, setFilter] = useState<'all' | 'changed' | 'error'>('all');
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  const fetchMonitor = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      await api.initialize();
      const data = await api.getMonitor(parseInt(id || '0'));
      if (data) {
        setMonitor({
          ...data,
          history: data.history || []
        } as MonitorDetail);
      }
    } catch (error) {
      console.error('Failed to fetch monitor:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMonitor();
  }, [fetchMonitor]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMonitor(true);
    setRefreshing(false);
  };

  const handleCheck = async () => {
    if (isChecking || !monitor) return;
    setIsChecking(true);
    try {
      await api.triggerCheck(monitor.id);
      await fetchMonitor(true);
      Alert.alert('Success', 'Check completed');
    } catch (error) {
      Alert.alert('Error', 'Check failed');
    } finally {
      setIsChecking(false);
    }
  };

  const handleOpenUrl = () => {
    if (monitor?.url) {
      Linking.openURL(monitor.url);
    }
  };

  const handleToggleActive = async () => {
    if (!monitor) return;
    const newActive = !monitor.active;
    try {
      // Optimistic update
      setMonitor({ ...monitor, active: newActive });
      await api.toggleMonitorStatus(monitor.id, newActive);
      Alert.alert('Success', newActive ? 'Monitor resumed' : 'Monitor paused');
    } catch (error) {
      // Revert on error
      setMonitor({ ...monitor, active: !newActive });
      Alert.alert('Error', 'Failed to update monitor');
    }
  };

  const handleDelete = () => {
    if (!monitor) return;
    Alert.alert(
      'Delete Monitor',
      'Are you sure you want to delete this monitor? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteMonitor(monitor.id);
              Alert.alert('Deleted', 'Monitor has been deleted');
              router.back();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete monitor');
            }
          }
        }
      ]
    );
  };

  const handleDeleteHistory = (historyId: number) => {
    if (!monitor) return;
    Alert.alert(
      'Delete Record',
      'Are you sure you want to delete this history record?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              // Optimistically update UI
              setMonitor({
                ...monitor,
                history: monitor.history?.filter(h => h.id !== historyId) || []
              });
              await api.deleteHistoryRecord(monitor.id, historyId);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete record');
              fetchMonitor(true);
            }
          }
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#238636" />
      </View>
    );
  }

  if (!monitor) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning" size={48} color="#f87171" />
        <Text style={styles.errorText}>Monitor not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tags: string[] = (() => {
    try { return JSON.parse(monitor.tags || '[]'); } catch { return []; }
  })();

  const filteredHistory = monitor.history?.filter(h => {
    if (filter === 'all') return true;
    if (filter === 'changed') return h.status === 'changed';
    if (filter === 'error') return h.status === 'error';
    return true;
  }) || [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {monitor.name || 'Monitor Details'}
            </Text>
            <TypeBadge type={monitor.type} />
          </View>
          <TouchableOpacity onPress={handleOpenUrl} style={styles.urlRow}>
            <Text style={styles.url} numberOfLines={1}>{monitor.url}</Text>
            <Ionicons name="open-outline" size={14} color="#3b82f6" />
          </TouchableOpacity>
          
          {/* Tags */}
          {tags.length > 0 && (
            <View style={styles.tagsRow}>
              {tags.map(tag => (
                <RNView key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </RNView>
              ))}
            </View>
          )}
        </View>
        
        {/* Check button */}
        <TouchableOpacity 
          style={[styles.checkBtn, isChecking && styles.checkBtnDisabled]}
          onPress={handleCheck}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="refresh" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Quick Actions Bar */}
      <View style={styles.actionsBar}>
        <TouchableOpacity 
          style={[styles.actionBtn, monitor.active ? styles.actionBtnWarning : styles.actionBtnSuccess]}
          onPress={handleToggleActive}
        >
          <Ionicons name={monitor.active ? 'pause' : 'play'} size={18} color="#fff" />
          <Text style={styles.actionBtnText}>{monitor.active ? 'Pause' : 'Resume'}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionBtn} onPress={handleOpenUrl}>
          <Ionicons name="open-outline" size={18} color="#fff" />
          <Text style={styles.actionBtnText}>Open URL</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={styles.actionBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#238636" />}
      >
        {/* Current Value Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Current Value</Text>
            <Text style={styles.cardMeta}>{timeAgo(monitor.last_check || '')}</Text>
          </View>
          
          {monitor.type === 'visual' && monitor.history?.[0]?.screenshot_path ? (
            <TouchableOpacity 
              style={styles.screenshotContainer}
              onPress={() => setSelectedScreenshot(monitor.history[0].screenshot_path || null)}
            >
              <Image 
                source={{ uri: `${api.getServerUrl()}/static/screenshots/${monitor.history[0].screenshot_path.split('/').pop()}` }}
                style={styles.screenshotImage}
              />
              <RNView style={styles.screenshotOverlay}>
                <Ionicons name="expand" size={24} color="#fff" />
              </RNView>
            </TouchableOpacity>
          ) : (
            <Text style={styles.currentValue} numberOfLines={10}>
              {cleanValue(monitor.last_value || '') || 'No value captured yet'}
            </Text>
          )}
        </View>

        {/* Monitor Config Card */}
        <View style={styles.configCard}>
          <View style={styles.configRow}>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Interval</Text>
              <Text style={styles.configValue}>{monitor.interval}</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Retries</Text>
              <Text style={styles.configValue}>{monitor.retry_count || 3}x</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Delay</Text>
              <Text style={styles.configValue}>{((monitor.retry_delay || 2000) / 1000).toFixed(1)}s</Text>
            </View>
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterRow}>
          <TouchableOpacity 
            style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
              All ({monitor.history?.length || 0})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterTab, filter === 'changed' && styles.filterTabActive]}
            onPress={() => setFilter('changed')}
          >
            <Text style={[styles.filterText, filter === 'changed' && styles.filterTextActive]}>
              Changed
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterTab, filter === 'error' && styles.filterTabActive]}
            onPress={() => setFilter('error')}
          >
            <Text style={[styles.filterText, filter === 'error' && styles.filterTextActive]}>
              Errors
            </Text>
          </TouchableOpacity>
        </View>

        {/* History Timeline */}
        <View style={styles.timeline}>
          {filteredHistory.length === 0 ? (
            <View style={styles.emptyHistory}>
              <Text style={styles.emptyHistoryText}>No history records</Text>
            </View>
          ) : (
            filteredHistory.map((record, index) => {
              // Get previous record for diff
              const prevRecord = filteredHistory[index + 1];
              const showDiff = record.status === 'changed' && prevRecord?.value && record.value;
              
              return (
                <SwipeableRow key={record.id} onDelete={() => handleDeleteHistory(record.id)}>
                  <View style={styles.historyItem}>
                    <RNView style={styles.timelineDot}>
                      <RNView style={[
                        styles.dot,
                        { backgroundColor: 
                          record.status === 'unchanged' ? '#22c55e' : 
                          record.status === 'changed' ? '#eab308' : '#ef4444' 
                        }
                      ]} />
                      {index < filteredHistory.length - 1 && <RNView style={styles.timelineLine} />}
                    </RNView>
                    
                    <View style={styles.historyContent}>
                      <View style={styles.historyHeader}>
                        <StatusBadge status={record.status} />
                        <Text style={styles.historyDate}>{formatDate(record.created_at)}</Text>
                      </View>
                      
                      {record.value && (
                        <View style={styles.valueContainer}>
                          {showDiff ? (
                            <View style={styles.diffContainer}>
                              <Text style={styles.diffLabel}>Change Diff</Text>
                              <View style={styles.diffContent}>
                                <Text style={styles.diffInlineText}>
                                  {diffWords(cleanValue(prevRecord.value || ''), cleanValue(record.value)).map((part: Change, idx: number) => (
                                    <Text 
                                      key={idx} 
                                      style={[
                                        part.added ? styles.diffTextAdded : 
                                        part.removed ? styles.diffTextRemoved : 
                                        styles.diffTextUnchanged
                                      ]}
                                    >
                                      {part.value}
                                    </Text>
                                  ))}
                                </Text>
                              </View>
                            </View>
                          ) : (
                            <Text style={styles.historyValue} numberOfLines={2}>
                              {cleanValue(record.value)}
                            </Text>
                          )}
                        </View>
                      )}
                      
                      {record.screenshot_path && (
                        <TouchableOpacity 
                          style={styles.historyScreenshot}
                          onPress={() => setSelectedScreenshot(record.screenshot_path || null)}
                        >
                          <Image 
                            source={{ uri: `${api.getServerUrl()}/static/screenshots/${record.screenshot_path.split('/').pop()}` }}
                            style={styles.historyScreenshotImage}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </SwipeableRow>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <TouchableOpacity 
          style={styles.modal}
          activeOpacity={1}
          onPress={() => setSelectedScreenshot(null)}
        >
          <Image 
            source={{ uri: `${api.getServerUrl()}/static/screenshots/${selectedScreenshot.split('/').pop()}` }}
            style={styles.modalImage}
            resizeMode="contain"
          />
          <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedScreenshot(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d1117',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0d1117',
    padding: 32,
  },
  errorText: {
    color: '#f87171',
    fontSize: 18,
    marginTop: 16,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#238636',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    paddingTop: 12,
    backgroundColor: '#0d1117',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  headerContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeVisual: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  badgeText: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  badgeLabelVisual: {
    color: '#60a5fa',
  },
  badgeLabelText: {
    color: '#4ade80',
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  url: {
    color: '#3b82f6',
    fontSize: 13,
    flex: 1,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    backgroundColor: 'transparent',
  },
  tag: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  tagText: {
    color: '#c084fc',
    fontSize: 11,
    fontWeight: '500',
  },
  checkBtn: {
    backgroundColor: '#238636',
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkBtnDisabled: {
    opacity: 0.5,
  },
  content: {
    flex: 1,
  },
  card: {
    backgroundColor: '#161b22',
    margin: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cardMeta: {
    color: '#8b949e',
    fontSize: 12,
  },
  currentValue: {
    color: '#c9d1d9',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'SpaceMono',
  },
  screenshotContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  screenshotImage: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  screenshotOverlay: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 6,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
    backgroundColor: 'transparent',
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#21262d',
  },
  filterTabActive: {
    backgroundColor: '#238636',
  },
  filterText: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#fff',
  },
  timeline: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    backgroundColor: 'transparent',
  },
  emptyHistory: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  emptyHistoryText: {
    color: '#6b7280',
    fontSize: 14,
  },
  historyItem: {
    flexDirection: 'row',
    marginBottom: 0,
    backgroundColor: 'transparent',
  },
  timelineDot: {
    width: 24,
    alignItems: 'center',
    marginRight: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#30363d',
    marginTop: 4,
  },
  historyContent: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  historyDate: {
    color: '#8b949e',
    fontSize: 11,
  },
  historyValue: {
    color: '#c9d1d9',
    fontSize: 13,
    fontFamily: 'SpaceMono',
    lineHeight: 18,
  },
  valueContainer: {
    marginTop: 4,
  },
  diffContainer: {
    marginTop: 8,
  },
  diffLabel: {
    fontSize: 10,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  diffContent: {
    backgroundColor: '#000',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    overflow: 'hidden',
  },
  diffLine: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  diffLineAdded: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  diffLineRemoved: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  diffLineText: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
  },
  diffTextAdded: {
    color: '#86efac',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  diffTextRemoved: {
    color: '#fca5a5',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  diffInlineText: {
    fontSize: 14,
    fontFamily: 'SpaceMono',
    lineHeight: 22,
  },
  diffTextUnchanged: {
    color: '#c9d1d9',
  },
  historyScreenshot: {
    marginTop: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  historyScreenshotImage: {
    width: '100%',
    height: 120,
    resizeMode: 'cover',
  },
  modal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '80%',
  },
  modalClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 8,
    borderRadius: 20,
  },
  actionsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#21262d',
  },
  actionBtnSuccess: {
    backgroundColor: '#238636',
  },
  actionBtnWarning: {
    backgroundColor: '#9a6700',
  },
  actionBtnDanger: {
    backgroundColor: '#b91c1c',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  configCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  configRow: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
  },
  configItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: 'transparent',
    borderRightWidth: 1,
    borderRightColor: '#21262d',
  },
  configLabel: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  configValue: {
    color: '#c9d1d9',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
});
