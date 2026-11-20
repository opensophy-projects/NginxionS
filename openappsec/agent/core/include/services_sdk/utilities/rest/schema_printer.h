 

#ifndef __SCHEMA_PRINTER_H__
#define __SCHEMA_PRINTER_H__

#include "rest/rest_param.h"
#include "rest/rest_helper.h"

template <typename N>
class TypeDector
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"object\",\n";
        N obj;
        obj.performOutputingSchema(os, level);
        os << "\n";
    }
};

template <typename N>
class TypeDector<RestParam<N>>
{
};

template <>
class TypeDector<bool>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"boolean\"\n";
    }
};

template <>
class TypeDector<std::string>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"string\"\n";
    }
};

template <>
class TypeDector<int>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"integer\"\n";
    }
};

template <>
class TypeDector<uint>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"unsigned integer\"\n";
    }
};

template <typename N>
class TypeDector<std::map<std::string, N>>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"object\",\n";
        RestHelper::printIndent(os, level) << "\"additionalProperties\": {\n";
        TypeDector<N>::type(os, level+1);
        RestHelper::printIndent(os, level) << "}\n";
    }
};

template <typename N>
class TypeDector<std::vector<N>>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"array\",\n";
        RestHelper::printIndent(os, level) << "\"items\": {\n";
        TypeDector<N>::type(os, level+1);
        RestHelper::printIndent(os, level) << "}\n";
    }
};

template <typename N>
class TypeDector<std::set<N>>
{
public:
    static void
    type(std::ostream &os, int level)
    {
        RestHelper::printIndent(os, level) << "\"type\": \"array\",\n";
        RestHelper::printIndent(os, level) << "\"items\": {\n";
        TypeDector<N>::type(os, level+1);
        RestHelper::printIndent(os, level) << "}\n";
    }
};

template <typename N>
class SchemaPrinter
{
public:
    static void
    print(std::ostream &os, int level, std::string name)
    {
        RestHelper::printIndent(os, level) << "\"" << name << "\": {\n";
        TypeDector<N>::type(os, level+1);
        RestHelper::printIndent(os, level) << "}";
    }
};

#endif // __SCHEMA_PRINTER_H__
