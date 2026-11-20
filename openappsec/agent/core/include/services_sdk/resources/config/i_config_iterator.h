 

#ifndef __I_CONFIG_ITERATOR_H__
#define __I_CONFIG_ITERATOR_H__

#ifndef __CONFIG_COMPONENT_H__
#error "i_config_iterator.h should not be included directly"
#endif // __CONFIG_COMPONENT_H__

#include "maybe_res.h"

template <typename ConfigurationType>
class I_Config_Iterator
{
public:
    virtual const ConfigurationType & operator*() const = 0;
    virtual void operator++() = 0;
    virtual void operator++(int) = 0;
    virtual bool operator==(const I_Config_Iterator<ConfigurationType> &other) const = 0;
    virtual bool operator!=(const I_Config_Iterator<ConfigurationType> &other) const = 0;
    virtual std::type_index getType() const = 0;
};

#endif // __I_CONFIG_ITERATOR_H__
