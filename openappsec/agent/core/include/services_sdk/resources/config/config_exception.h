 

#ifndef __CONFIG_EXCEPTION_H__
#define __CONFIG_EXCEPTION_H__

#ifndef __CONFIG_H__
#error "config_exception.h should not be included directly"
#endif // __CONFIG_H__

namespace Config
{

class ConfigException
{
public:
    ConfigException(const std::string &_str) : str(_str) {}
    const std::string & getError() const { return str; }

private:
    std::string str;
};

} // namespace Config

#endif // __CONFIG_EXCEPTION_H__
