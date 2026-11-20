 

#ifndef __METRIC_METADATA_H__
#define __METRIC_METADATA_H__

#ifndef __GENERIC_METRIC_H__
#error metric/metric_metadata.h should not be included directly
#endif // __GENERIC_METRIC_H_

#include <string>

namespace MetricMetadata
{

struct DotName
{
    std::string val;
};

struct Units
{
    std::string val;
};

struct Description
{
    std::string val;
};

} //MetricMetadata

#endif // __METRIC_METADATA_H__
