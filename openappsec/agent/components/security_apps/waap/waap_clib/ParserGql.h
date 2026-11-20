 

#ifndef __PARSER_GQL_H
#define __PARSER_GQL_H

#include <string.h>
#include <vector>

#include "ParserBase.h"
#include "graphqlparser/Ast.h"
#include "graphqlparser/AstNode.h"
#include "graphqlparser/AstVisitor.h"
#include "KeyStack.h"
#include "i_transaction.h"
#include "singleton.h"
#include "i_oa_schema_updater.h"

class ParserGql :
    public ParserBase,
    public facebook::graphql::ast::visitor::AstVisitor,
    Singleton::Consume<I_OASUpdater> {
public:
    ParserGql(
        IParserReceiver &receiver,
        size_t parser_depth,
        IWaf2Transaction *pTransaction=nullptr);
    virtual ~ParserGql();
    size_t push(const char *data, size_t data_len);
    void finish();
    virtual const std::string &name() const;
    bool error() const;
    virtual size_t depth() { return 0; }
private:
    IParserReceiver &m_receiver;
    bool m_error;
    std::string m_buffer;
    std::string m_curNodeName;
    int m_curNameValues;
    IWaf2Transaction *m_pTransaction;
    int field_depth;
    bool visitValue(const char *value);

    // Callbacks from the parser
    bool visitOperationDefinition(const facebook::graphql::ast::OperationDefinition &node) override;
    bool visitName(const facebook::graphql::ast::Name &node) override;
    bool visitIntValue(const facebook::graphql::ast::IntValue &node) override;
    bool visitFloatValue(const facebook::graphql::ast::FloatValue &node) override;
    bool visitStringValue(const facebook::graphql::ast::StringValue &node) override;
    bool visitBooleanValue(const facebook::graphql::ast::BooleanValue &node) override;
    bool visitNullValue(const facebook::graphql::ast::NullValue &node) override;
    bool visitEnumValue(const facebook::graphql::ast::EnumValue &node) override;
public:
    static const std::string m_parserName;
    size_t m_parser_depth;
};

#endif // __PARSER_JQL_H
