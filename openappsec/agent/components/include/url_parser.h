 

#ifndef __URL_PARSER_H__
#define __URL_PARSER_H__

#include "orchestration_tools.h"

#include <string>
#include <ostream>

enum class URLProtocol
{
    HTTP,
    HTTPS,
    LOCAL_FILE
};

class URLParser
{
public:
    URLParser(const std::string &url);

    Maybe<std::string> getBaseURL() const;
    bool isOverSSL() const { return over_ssl; }
    std::string getPort() const { return port; }
    std::string getQuery() const { return query; }
    std::string getHost() const;
    URLProtocol getProtocol() const { return protocol; }
    std::string toString() const;
    void setHost(const std::string &new_host);
    void setQuery(const std::string &new_query);

private:
    void parseURL(const std::string &url);
    URLProtocol parseProtocol(const std::string &url) const;

    bool over_ssl;
    std::string base_url;
    std::string port;
    std::string query;
    std::string host;
    URLProtocol protocol;
};

std::ostream & operator<<(std::ostream &os, const URLParser &url);
std::ostream & operator<<(std::ostream &os, const URLProtocol &protocol);

#endif // __URL_PARSER_H__
