

/// @file ngx_cp_metric.h
#ifndef __NGX_CP_METRIC_H__
#define __NGX_CP_METRIC_H__

#include <nano_attachment_common.h>
#include <ngx_config.h>
#include <ngx_core.h>

///
/// @brief Depending on the metric type, set the provided value in the metric.
/// @param[in] metric_type Metric type to update.
/// @param[in] value Value to set.
///
void updateMetricField(AttachmentMetricType metric_type, uint64_t value);

///
/// @brief Goes over all the metrics and resets them to 0.
///
void reset_metric_data();

#endif // __NGX_CP_METRIC_H__
