import { useState, useEffect } from 'react';
import { PrivateFeedbackDTO, LocationDTO } from '@review-system/shared';
import { api } from '../api.js';

interface FeedbackInboxViewProps {
  tenantId: string;
  locations: LocationDTO[];
}

export function FeedbackInboxView({ tenantId, locations }: FeedbackInboxViewProps) {
  const [feedback, setFeedback] = useState<PrivateFeedbackDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [statusFilter, setStatusFilter] = useState<'new' | 'reviewed' | 'archived' | 'all'>('new');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeedback = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getFeedback(tenantId, {
        locationId: locationFilter || undefined,
        status: statusFilter,
        page,
        limit,
      });
      setFeedback(res.feedback);
      setTotal(res.pagination.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load private feedback');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedback();
  }, [tenantId, statusFilter, locationFilter, page]);

  const handleStatusChange = async (feedbackId: string, nextStatus: 'reviewed' | 'archived') => {
    try {
      setError(null);
      await api.updateFeedbackStatus(tenantId, feedbackId, nextStatus);
      await fetchFeedback();
    } catch (err: any) {
      setError(err.message || 'Failed to update feedback status');
    }
  };

  const locationMap = new Map(locations.map((loc) => [loc.id, loc.name]));
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header and Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '20px' }}>Private Customer Feedback Inbox</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
            Direct customer-to-merchant feedback submitted via QR campaigns. Unshared publicly.
          </p>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Location Filter */}
          <select
            value={locationFilter}
            onChange={(e) => {
              setLocationFilter(e.target.value);
              setPage(1);
            }}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '13px',
              backgroundColor: '#fff',
            }}
          >
            <option value="">All Locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '13px',
              backgroundColor: '#fff',
            }}
          >
            <option value="new">Status: New</option>
            <option value="reviewed">Status: Reviewed</option>
            <option value="archived">Status: Archived</option>
            <option value="all">Status: All</option>
          </select>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            borderRadius: '6px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {/* Feedback List */}
      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading feedback entries...</p>
      ) : feedback.length === 0 ? (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            border: '1px dashed #d1d5db',
            borderRadius: '8px',
            color: '#6b7280',
          }}
        >
          No feedback entries found matching your filter criteria.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {feedback.map((item) => {
            const locName = locationMap.get(item.locationId) || 'Location';
            const dateStr = new Date(item.createdAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            });

            return (
              <div
                key={item.id}
                style={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {/* Top Row: Rating, Status, Date & Location */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* 5-Star Visualizer */}
                    <div style={{ display: 'flex', gap: '2px', fontSize: '18px' }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <span
                          key={star}
                          style={{
                            color: star <= item.rating ? '#eab308' : '#d1d5db',
                          }}
                        >
                          &#9733;
                        </span>
                      ))}
                    </div>

                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontWeight: 600,
                        backgroundColor:
                          item.status === 'new'
                            ? '#dbeafe'
                            : item.status === 'reviewed'
                            ? '#ede9fe'
                            : '#f3f4f6',
                        color:
                          item.status === 'new'
                            ? '#1e40af'
                            : item.status === 'reviewed'
                            ? '#6b21a8'
                            : '#4b5563',
                      }}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    <strong>{locName}</strong> &bull; {dateStr}
                  </div>
                </div>

                {/* Feedback Text */}
                <div style={{ fontSize: '14px', color: '#1f2937', lineHeight: 1.5 }}>
                  {item.feedbackText ? (
                    <blockquote
                      style={{
                        margin: 0,
                        padding: '8px 12px',
                        backgroundColor: '#f9fafb',
                        borderLeft: '4px solid #3b82f6',
                        borderRadius: '4px',
                      }}
                    >
                      "{item.feedbackText}"
                    </blockquote>
                  ) : (
                    <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                      Rating submitted without additional written text.
                    </span>
                  )}
                </div>

                {/* Services Tags Snapshot */}
                {item.services && item.services.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>Services:</span>
                    {item.services.map((s) => (
                      <span
                        key={s.serviceId}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          backgroundColor: '#f3f4f6',
                          color: '#374151',
                          borderRadius: '4px',
                          border: '1px solid #e5e7eb',
                        }}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Bottom Row: Customer Contact & Actions */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid #f3f4f6',
                    paddingTop: '10px',
                    marginTop: '2px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#4b5563' }}>
                    {item.customerContact ? (
                      <span>
                        Customer Contact: <strong>{item.customerContact}</strong>
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>No contact details provided</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {item.status === 'new' && (
                      <button
                        onClick={() => handleStatusChange(item.id, 'reviewed')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          backgroundColor: '#6b21a8',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Mark Reviewed
                      </button>
                    )}

                    {item.status !== 'archived' && (
                      <button
                        onClick={() => handleStatusChange(item.id, 'archived')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          backgroundColor: '#fff',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          color: '#4b5563',
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '12px' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: page === 1 ? 'not-allowed' : 'pointer',
              opacity: page === 1 ? 0.5 : 1,
            }}
          >
            &larr; Previous
          </button>
          <span style={{ fontSize: '13px', color: '#4b5563' }}>
            Page {page} of {totalPages} ({total} total)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              opacity: page >= totalPages ? 0.5 : 1,
            }}
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
