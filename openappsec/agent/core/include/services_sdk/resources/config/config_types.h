 

#ifndef __CONFIG_TYPES_H__
#define __CONFIG_TYPES_H__

#ifndef __CONFIG_H__
#error "config_types.h should not be included directly"
#endif // __CONFIG_H__

#include <functional>

namespace Config
{

using ConfigCb = std::function<void(void)>;

enum class Errors { MISSING_TAG, MISSING_CONTEXT, BAD_NODE };
enum class ConfigFileType { Policy, Data, RawData, COUNT };

} // namespace Config

#endif // __CONFIG_TYPES_H__
