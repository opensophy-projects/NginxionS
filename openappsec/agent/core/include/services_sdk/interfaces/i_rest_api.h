 

#ifndef __I_REST_API__
#define __I_REST_API__

#include "rest.h"

#include <string>
#include <memory>

#include "common.h"

enum class RestAction { ADD, SET, SHOW, DELETE };

// The RestInit class provides an interface through which new JsonRest object can be created.
class RestInit
{
public:
    ~RestInit() {}
    virtual std::unique_ptr<ServerRest> getRest() = 0;
};

template <typename T>
class SpecificRestInit : public RestInit
{
public:
    std::unique_ptr<ServerRest> getRest() override { return std::make_unique<T>(); }
};

class I_RestApi
{
public:
    template <typename T>
    bool
    addRestCall(RestAction oper, const std::string &uri)
    {
        return addRestCall(oper, uri, std::make_unique<SpecificRestInit<T>>());
    }

    virtual bool addGetCall(const std::string &uri, const std::function<std::string()> &callback) = 0;
    virtual bool addWildcardGetCall(
        const std::string &uri,
        const std::function<std::string(const std::string &)> &callback
    ) = 0;
    virtual bool addPostCall(
        const std::string &uri,
        const std::function<Maybe<std::string>(const std::string &)> &callback
    ) = 0;

    virtual uint16_t getListeningPort() const = 0;
    virtual uint16_t getStartingPortRange() const = 0;

protected:
    ~I_RestApi() {}
    virtual bool addRestCall(RestAction oper, const std::string &uri, std::unique_ptr<RestInit> &&init) = 0;
};

#endif // __I_REST_API__
